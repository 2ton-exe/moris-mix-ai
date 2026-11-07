create table public.recipe_image_staging_reconciliation_state (
    singleton boolean primary key default true check (singleton),
    continuation_token text check (continuation_token is null or length(continuation_token) <= 4096),
    lease_id uuid,
    lease_until timestamptz,
    status text not null default 'ready' check (status in ('ready', 'claimed', 'retry', 'failed')),
    attempts integer not null default 0 check (attempts between 0 and 8),
    next_attempt_at timestamptz,
    last_error text check (last_error is null or last_error in ('configuration', 'network', 'r2_rejected', 'r2_unavailable', 'unexpected')),
    completed_scans bigint not null default 0 check (completed_scans >= 0),
    updated_at timestamptz not null default now(),
    check (
        (status = 'claimed' and lease_id is not null and lease_until is not null)
        or (status <> 'claimed' and lease_id is null and lease_until is null)
    ),
    check ((status = 'retry') = (next_attempt_at is not null)),
    check (status <> 'failed' or (attempts = 8 and next_attempt_at is null))
);

insert into public.recipe_image_staging_reconciliation_state (singleton) values (true);

create table public.recipe_image_staging_reconciliation_objects (
    staging_key text primary key check (staging_key ~ '^recipe-images/staging/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
    intent_id uuid,
    status text not null default 'queued' check (status in ('queued', 'claimed', 'retry', 'complete', 'failed')),
    attempts integer not null default 0 check (attempts between 0 and 8),
    lease_id uuid,
    lease_until timestamptz,
    next_attempt_at timestamptz,
    completed_at timestamptz,
    last_error text check (last_error is null or last_error in ('configuration', 'network', 'r2_rejected', 'r2_unavailable', 'unexpected')),
    updated_at timestamptz not null default now(),
    check (
        (status = 'claimed' and lease_id is not null and lease_until is not null)
        or (status <> 'claimed' and lease_id is null and lease_until is null)
    ),
    check ((status = 'retry') = (next_attempt_at is not null)),
    check ((status = 'complete') = (completed_at is not null)),
    check (status <> 'failed' or (attempts = 8 and next_attempt_at is null))
);

create index recipe_image_staging_reconciliation_objects_work_idx
    on public.recipe_image_staging_reconciliation_objects (status, next_attempt_at, lease_until);

alter table public.recipe_image_staging_reconciliation_state enable row level security;
alter table public.recipe_image_staging_reconciliation_state force row level security;
alter table public.recipe_image_staging_reconciliation_objects enable row level security;
alter table public.recipe_image_staging_reconciliation_objects force row level security;

revoke all on table public.recipe_image_staging_reconciliation_state from public;
revoke all on table public.recipe_image_staging_reconciliation_objects from public;

create or replace function public.claim_recipe_image_staging_reconciliation_page(p_lease_id uuid)
returns table (continuation_token text)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_cursor text;
    v_status text;
    v_lease_until timestamptz;
    v_attempts integer;
    v_next_attempt timestamptz;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Unauthorized upload cleanup operation' using errcode = '42501';
    end if;
    if p_lease_id is null then
        raise exception 'Invalid reconciliation lease' using errcode = '22023';
    end if;

    delete from public.recipe_image_staging_reconciliation_objects as completed
    where completed.staging_key in (
        select retained.staging_key
        from public.recipe_image_staging_reconciliation_objects as retained
        where retained.status in ('complete', 'failed')
          and coalesce(retained.completed_at, retained.updated_at) < now() - interval '30 days'
        order by coalesce(retained.completed_at, retained.updated_at), retained.staging_key
        limit 500
    );

    select state.continuation_token, state.status, state.lease_until, state.attempts, state.next_attempt_at
    into v_cursor, v_status, v_lease_until, v_attempts, v_next_attempt
    from public.recipe_image_staging_reconciliation_state as state
    where state.singleton = true
    for update;

    if not found then
        raise exception 'Reconciliation state is unavailable';
    end if;
    if v_status = 'failed' or (v_status = 'claimed' and v_lease_until > now()) or (v_status = 'retry' and v_next_attempt > now()) then
        return;
    end if;
    if v_attempts >= 8 then
        update public.recipe_image_staging_reconciliation_state as state
        set status = 'failed',
            lease_id = null,
            lease_until = null,
            next_attempt_at = null,
            last_error = coalesce(state.last_error, 'unexpected'),
            updated_at = now()
        where state.singleton = true;
        return;
    end if;

    update public.recipe_image_staging_reconciliation_state as state
    set status = 'claimed',
        attempts = state.attempts + 1,
        lease_id = p_lease_id,
        lease_until = now() + interval '10 minutes',
        next_attempt_at = null,
        updated_at = now()
    where state.singleton = true;

    return query select v_cursor;
end;
$$;

create or replace function public.claim_recipe_image_staging_reconciliation_objects(
    p_page_lease_id uuid,
    p_staging_keys text[]
)
returns table (staging_key text, intent_id uuid)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Unauthorized upload cleanup operation' using errcode = '42501';
    end if;
    if p_page_lease_id is null or p_staging_keys is null or cardinality(p_staging_keys) > 25 then
        raise exception 'Invalid reconciliation page' using errcode = '22023';
    end if;
    if not exists (
        select 1
        from public.recipe_image_staging_reconciliation_state as state
        where state.singleton = true
          and state.status = 'claimed'
          and state.lease_id = p_page_lease_id
          and state.lease_until > now()
    ) then
        raise exception 'Reconciliation page lease is not active' using errcode = '42501';
    end if;

    with listed as (
        select distinct keys.staging_key
        from unnest(p_staging_keys) as keys(staging_key)
        where keys.staging_key ~ '^recipe-images/staging/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ), eligible as (
        select listed.staging_key, intent.id as intent_id
        from listed
        left join public.recipe_image_upload_intents as intent
          on intent.staging_key = listed.staging_key
        where intent.id is null
           or (intent.state = 'expired' and intent.cleanup_status = 'complete')
    )
    insert into public.recipe_image_staging_reconciliation_objects as existing (
        staging_key, intent_id, status
    )
    select eligible.staging_key, eligible.intent_id, 'queued'
    from eligible
    on conflict (staging_key) do update
    set intent_id = excluded.intent_id,
        status = 'queued',
        attempts = 0,
        lease_id = null,
        lease_until = null,
        next_attempt_at = null,
        completed_at = null,
        last_error = null,
        updated_at = now()
    where existing.status = 'complete';

    update public.recipe_image_staging_reconciliation_objects as abandoned
    set status = 'failed',
        lease_id = null,
        lease_until = null,
        next_attempt_at = null,
        last_error = coalesce(abandoned.last_error, 'unexpected'),
        updated_at = now()
    where abandoned.staging_key = any(p_staging_keys)
      and abandoned.status = 'claimed'
      and abandoned.lease_until <= now()
      and abandoned.attempts >= 8;

    return query
    with candidates as (
        select objects.staging_key
        from public.recipe_image_staging_reconciliation_objects as objects
        where objects.attempts < 8
          and (
              objects.intent_id is null
              or not exists (
                  select 1
                  from public.recipe_image_upload_intents as removed_intent
                  where removed_intent.id = objects.intent_id
              )
              or exists (
                  select 1
                  from public.recipe_image_upload_intents as active_intent
                  where active_intent.id = objects.intent_id
                    and active_intent.state = 'expired'
                    and active_intent.cleanup_status = 'complete'
              )
          )
          and (
              objects.status = 'queued'
              or (objects.status = 'retry' and objects.next_attempt_at <= now())
              or (objects.status = 'claimed' and objects.lease_until <= now())
          )
        order by objects.updated_at, objects.staging_key
        limit 15
        for update skip locked
    )
    update public.recipe_image_staging_reconciliation_objects as objects
    set status = 'claimed',
        attempts = objects.attempts + 1,
        lease_id = p_page_lease_id,
        lease_until = now() + interval '10 minutes',
        next_attempt_at = null,
        completed_at = null,
        updated_at = now()
    from candidates
    where objects.staging_key = candidates.staging_key
    returning objects.staging_key, objects.intent_id;
end;
$$;

create or replace function public.finish_recipe_image_staging_reconciliation_object(
    p_page_lease_id uuid,
    p_staging_key text,
    p_success boolean,
    p_failure text default null
)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_attempts integer;
    v_status text;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Unauthorized upload cleanup operation' using errcode = '42501';
    end if;
    if p_success is null then
        raise exception 'Invalid reconciliation result' using errcode = '22023';
    end if;

    select objects.attempts, objects.status
    into v_attempts, v_status
    from public.recipe_image_staging_reconciliation_objects as objects
    where objects.staging_key = p_staging_key
      and objects.lease_id = p_page_lease_id
    for update;

    if not found or v_status <> 'claimed' then
        return 'not_claimed';
    end if;
    if p_success then
        update public.recipe_image_staging_reconciliation_objects as objects
        set status = 'complete',
            lease_id = null,
            lease_until = null,
            next_attempt_at = null,
            completed_at = now(),
            last_error = null,
            updated_at = now()
        where objects.staging_key = p_staging_key;
        return 'complete';
    end if;
    if p_failure is null or p_failure not in ('configuration', 'network', 'r2_rejected', 'r2_unavailable', 'unexpected') then
        raise exception 'Invalid reconciliation failure category' using errcode = '22023';
    end if;

    update public.recipe_image_staging_reconciliation_objects as objects
    set status = case when v_attempts >= 8 then 'failed' else 'retry' end,
        lease_id = null,
        lease_until = null,
        next_attempt_at = case
            when v_attempts >= 8 then null
            else now() + make_interval(mins => least(60, power(2, least(v_attempts, 6))::integer))
        end,
        last_error = p_failure,
        updated_at = now()
    where objects.staging_key = p_staging_key;

    return case when v_attempts >= 8 then 'failed' else 'retry' end;
end;
$$;

create or replace function public.finish_recipe_image_staging_reconciliation_page(
    p_lease_id uuid,
    p_next_token text,
    p_has_more boolean,
    p_failure text default null
)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_attempts integer;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Unauthorized upload cleanup operation' using errcode = '42501';
    end if;

    select state.attempts
    into v_attempts
    from public.recipe_image_staging_reconciliation_state as state
    where state.singleton = true
      and state.status = 'claimed'
      and state.lease_id = p_lease_id
      and state.lease_until > now()
    for update;

    if not found then
        return 'not_claimed';
    end if;
    if p_has_more is null then
        raise exception 'Invalid reconciliation page state' using errcode = '22023';
    end if;
    if p_failure is null then
        if (p_has_more and (p_next_token is null or length(p_next_token) > 4096))
            or (not p_has_more and p_next_token is not null) then
            raise exception 'Invalid reconciliation continuation token' using errcode = '22023';
        end if;
        update public.recipe_image_staging_reconciliation_state as state
        set continuation_token = p_next_token,
            status = 'ready',
            attempts = 0,
            lease_id = null,
            lease_until = null,
            next_attempt_at = null,
            last_error = null,
            completed_scans = state.completed_scans + case when p_has_more then 0 else 1 end,
            updated_at = now()
        where state.singleton = true;
        return 'complete';
    end if;
    if p_failure not in ('configuration', 'network', 'r2_rejected', 'r2_unavailable', 'unexpected') then
        raise exception 'Invalid reconciliation failure category' using errcode = '22023';
    end if;

    update public.recipe_image_staging_reconciliation_state as state
    set status = case when v_attempts >= 8 then 'failed' else 'retry' end,
        lease_id = null,
        lease_until = null,
        next_attempt_at = case
            when v_attempts >= 8 then null
            else now() + make_interval(mins => least(60, power(2, least(v_attempts, 6))::integer))
        end,
        last_error = p_failure,
        updated_at = now()
    where state.singleton = true;

    return case when v_attempts >= 8 then 'failed' else 'retry' end;
end;
$$;

create or replace function public.recipe_image_staging_reconciliation_health()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_pending integer;
    v_failed integer;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Unauthorized upload cleanup operation' using errcode = '42501';
    end if;

    select
        count(*) filter (
            where (objects.status in ('queued', 'retry') and objects.next_attempt_at < now() - interval '1 hour')
               or (objects.status = 'queued' and objects.updated_at < now() - interval '1 hour')
               or (objects.status = 'claimed' and objects.lease_until < now())
        )
        + (select count(*) from public.recipe_image_staging_reconciliation_state as state
           where (state.status = 'retry' and state.next_attempt_at < now() - interval '1 hour')
              or (state.status = 'claimed' and state.lease_until < now()))
    into v_pending
    from public.recipe_image_staging_reconciliation_objects as objects;

    select
        (select count(*) from public.recipe_image_staging_reconciliation_objects as objects where objects.status = 'failed')
        + (select count(*) from public.recipe_image_staging_reconciliation_state as state where state.status = 'failed')
    into v_failed;

    return jsonb_build_object('pending', v_pending, 'failed', v_failed);
end;
$$;

revoke all on function public.claim_recipe_image_staging_reconciliation_page(uuid) from public;
revoke all on function public.claim_recipe_image_staging_reconciliation_objects(uuid, text[]) from public;
revoke all on function public.finish_recipe_image_staging_reconciliation_object(uuid, text, boolean, text) from public;
revoke all on function public.finish_recipe_image_staging_reconciliation_page(uuid, text, boolean, text) from public;
revoke all on function public.recipe_image_staging_reconciliation_health() from public;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        execute 'revoke all on table public.recipe_image_staging_reconciliation_state from anon';
        execute 'revoke all on table public.recipe_image_staging_reconciliation_objects from anon';
        execute 'revoke all on function public.claim_recipe_image_staging_reconciliation_page(uuid) from anon';
        execute 'revoke all on function public.claim_recipe_image_staging_reconciliation_objects(uuid, text[]) from anon';
        execute 'revoke all on function public.finish_recipe_image_staging_reconciliation_object(uuid, text, boolean, text) from anon';
        execute 'revoke all on function public.finish_recipe_image_staging_reconciliation_page(uuid, text, boolean, text) from anon';
        execute 'revoke all on function public.recipe_image_staging_reconciliation_health() from anon';
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
        execute 'revoke all on table public.recipe_image_staging_reconciliation_state from authenticated';
        execute 'revoke all on table public.recipe_image_staging_reconciliation_objects from authenticated';
        execute 'revoke all on function public.claim_recipe_image_staging_reconciliation_page(uuid) from authenticated';
        execute 'revoke all on function public.claim_recipe_image_staging_reconciliation_objects(uuid, text[]) from authenticated';
        execute 'revoke all on function public.finish_recipe_image_staging_reconciliation_object(uuid, text, boolean, text) from authenticated';
        execute 'revoke all on function public.finish_recipe_image_staging_reconciliation_page(uuid, text, boolean, text) from authenticated';
        execute 'revoke all on function public.recipe_image_staging_reconciliation_health() from authenticated';
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
        execute 'revoke all on table public.recipe_image_staging_reconciliation_state from service_role';
        execute 'revoke all on table public.recipe_image_staging_reconciliation_objects from service_role';
        execute 'grant execute on function public.claim_recipe_image_staging_reconciliation_page(uuid) to service_role';
        execute 'grant execute on function public.claim_recipe_image_staging_reconciliation_objects(uuid, text[]) to service_role';
        execute 'grant execute on function public.finish_recipe_image_staging_reconciliation_object(uuid, text, boolean, text) to service_role';
        execute 'grant execute on function public.finish_recipe_image_staging_reconciliation_page(uuid, text, boolean, text) to service_role';
        execute 'grant execute on function public.recipe_image_staging_reconciliation_health() to service_role';
    end if;
end;
$$;
