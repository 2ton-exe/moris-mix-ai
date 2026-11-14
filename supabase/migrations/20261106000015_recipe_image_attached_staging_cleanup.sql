-- Attached intents retain their replay result while staging cleanup runs after expiry.
alter table public.recipe_image_upload_intents
    drop constraint recipe_image_upload_intents_cleanup_state_check;
alter table public.recipe_image_upload_intents
    add constraint recipe_image_upload_intents_cleanup_state_check check (
        (state in ('pending', 'finalizing') and cleanup_status = 'waiting')
        or state = 'attached'
        or (state = 'expired' and cleanup_status <> 'waiting')
    );

create or replace function public.claim_expired_recipe_image_uploads(
    p_limit integer default 50
)
returns table (id uuid, staging_key text)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Unauthorized upload cleanup operation' using errcode = '42501';
    end if;

    delete from public.recipe_image_upload_intents as retained
    where retained.id in (
        select candidate.id
        from public.recipe_image_upload_intents as candidate
        where candidate.state = 'expired'
          and candidate.cleanup_status = 'complete'
          and candidate.cleanup_completed_at < now() - interval '30 days'
        order by candidate.cleanup_completed_at, candidate.id
        limit 500
    );

    with expired as (
        select i.id
        from public.recipe_image_upload_intents i
        where i.state in ('pending', 'attached')
          and i.expires_at <= now()
          and i.cleanup_status = 'waiting'
        order by i.expires_at, i.id
        limit 100
        for update skip locked
    )
    update public.recipe_image_upload_intents i
    set state = case when i.state = 'pending' then 'expired' else i.state end,
        cleanup_status = 'queued',
        cleanup_next_attempt_at = now()
    from expired e
    where i.id = e.id;

    update public.recipe_image_upload_intents
    set cleanup_status = 'failed',
        cleanup_lease_until = null,
        cleanup_next_attempt_at = null,
        cleanup_last_error = 'unexpected'
    where state in ('expired', 'attached')
      and cleanup_status = 'claimed'
      and cleanup_attempts >= 8
      and cleanup_lease_until <= now();

    return query
    with candidates as (
        select i.id
        from public.recipe_image_upload_intents i
        where i.state in ('expired', 'attached')
          and i.cleanup_status in ('queued', 'retry', 'claimed')
          and coalesce(i.cleanup_next_attempt_at, now()) <= now()
          and (i.cleanup_lease_until is null or i.cleanup_lease_until <= now())
        order by i.expires_at, i.id
        limit least(greatest(coalesce(p_limit, 50), 1), 100)
        for update skip locked
    )
    update public.recipe_image_upload_intents i
    set cleanup_status = 'claimed',
        cleanup_attempts = i.cleanup_attempts + 1,
        cleanup_lease_until = now() + interval '10 minutes',
        cleanup_next_attempt_at = null
    from candidates c
    where i.id = c.id
    returning i.id, i.staging_key;
end;
$$;

create or replace function public.recipe_image_upload_cleanup_health()
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
            where (
                (cleanup_status in ('queued', 'retry') and cleanup_next_attempt_at < now() - interval '1 hour')
                or (cleanup_status = 'claimed' and cleanup_lease_until < now())
            )
        ),
        count(*) filter (where cleanup_status = 'failed')
    into v_pending, v_failed
    from public.recipe_image_upload_intents
    where state in ('expired', 'attached')
      and cleanup_status <> 'complete';

    return jsonb_build_object('pending', v_pending, 'failed', v_failed);
end;
$$;

create or replace function public.finish_recipe_image_upload_cleanup(
    p_id uuid,
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

    select cleanup_attempts, cleanup_status into v_attempts, v_status
    from public.recipe_image_upload_intents
    where id = p_id and state in ('expired', 'attached')
    for update;

    if not found or v_status <> 'claimed' then
        return 'not_claimed';
    end if;

    if p_success then
        update public.recipe_image_upload_intents
        set cleanup_status = 'complete',
            cleanup_lease_until = null,
            cleanup_next_attempt_at = null,
            cleanup_completed_at = now(),
            cleanup_last_error = null
        where id = p_id;
        return 'complete';
    end if;

    if p_failure is null or p_failure not in ('configuration', 'network', 'r2_rejected', 'r2_unavailable', 'unexpected') then
        raise exception 'Invalid upload cleanup failure category' using errcode = '22023';
    end if;

    update public.recipe_image_upload_intents
    set cleanup_status = case when v_attempts >= 8 then 'failed' else 'retry' end,
        cleanup_lease_until = null,
        cleanup_next_attempt_at = case
            when v_attempts >= 8 then null
            else now() + make_interval(mins => least(60, power(2, least(v_attempts, 6))::integer))
        end,
        cleanup_last_error = p_failure
    where id = p_id;

    return case when v_attempts >= 8 then 'failed' else 'retry' end;
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
           or (intent.state in ('expired', 'attached') and intent.cleanup_status = 'complete' and intent.expires_at <= now())
    )
    insert into public.recipe_image_staging_reconciliation_objects as existing (
        staging_key, intent_id, status
    )
    select eligible.staging_key, eligible.intent_id, 'queued'
    from eligible
    on conflict on constraint recipe_image_staging_reconciliation_objects_pkey do update
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
    where abandoned.status = 'claimed'
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
                    and active_intent.state in ('expired', 'attached')
                    and active_intent.cleanup_status = 'complete'
                    and active_intent.expires_at <= now()
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
