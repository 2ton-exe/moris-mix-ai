alter table public.recipe_image_upload_intents
    drop constraint recipe_image_upload_intents_state_check;

alter table public.recipe_image_upload_intents
    add constraint recipe_image_upload_intents_state_check
    check (state in ('pending', 'finalizing', 'attached', 'expired'));

alter table public.recipe_image_upload_intents
    add column cleanup_status text not null default 'waiting'
        check (cleanup_status in ('waiting', 'queued', 'claimed', 'retry', 'complete', 'failed')),
    add column cleanup_attempts integer not null default 0
        check (cleanup_attempts >= 0),
    add column cleanup_lease_until timestamptz,
    add column cleanup_next_attempt_at timestamptz,
    add column cleanup_completed_at timestamptz,
    add column cleanup_last_error text
        check (cleanup_last_error is null or cleanup_last_error in ('configuration', 'network', 'r2_rejected', 'r2_unavailable', 'unexpected')),
    add constraint recipe_image_upload_intents_cleanup_state_check
        check (
            (state in ('pending', 'finalizing') and cleanup_status = 'waiting')
            or (state = 'attached' and cleanup_status in ('waiting', 'complete'))
            or (state = 'expired' and cleanup_status <> 'waiting')
        ),
    add constraint recipe_image_upload_intents_cleanup_completion_check
        check ((cleanup_status = 'complete') = (cleanup_completed_at is not null));

create index recipe_image_upload_intents_cleanup_idx
    on public.recipe_image_upload_intents (cleanup_status, cleanup_next_attempt_at, expires_at);

create or replace function public.create_recipe_image_upload_intent(
    p_id uuid,
    p_user_id uuid,
    p_recipe_id uuid,
    p_staging_key text,
    p_final_key text,
    p_content_type text,
    p_byte_size integer,
    p_created_at timestamptz,
    p_expires_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_hourly_count integer;
    v_outstanding_count integer;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Unauthorized upload intent operation' using errcode = '42501';
    end if;

    perform pg_advisory_xact_lock(hashtext('recipe-image-upload:' || p_user_id::text));

    select count(*) into v_hourly_count
    from public.recipe_image_upload_intents
    where user_id = p_user_id
      and created_at > now() - interval '1 hour';

    if v_hourly_count >= 10 then
        return 'rate_limited';
    end if;

    select count(*) into v_outstanding_count
    from public.recipe_image_upload_intents
    where user_id = p_user_id
      and state in ('pending', 'finalizing', 'attached', 'expired')
      and cleanup_status <> 'complete';

    if v_outstanding_count >= 3 then
        return 'pending_limit';
    end if;

    insert into public.recipe_image_upload_intents (
        id, user_id, recipe_id, staging_key, final_key,
        content_type, byte_size, created_at, expires_at, state
    ) values (
        p_id, p_user_id, p_recipe_id, p_staging_key, p_final_key,
        p_content_type, p_byte_size, p_created_at, p_expires_at, 'pending'
    );

    return 'allowed';
end;
$$;

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

    delete from public.recipe_image_upload_intents
    where id in (
        select id
        from public.recipe_image_upload_intents
        where state = 'expired'
          and cleanup_status = 'complete'
          and cleanup_completed_at < now() - interval '30 days'
        order by cleanup_completed_at, id
        limit 500
    );

    with expired as (
        select i.id
        from public.recipe_image_upload_intents i
        where i.state = 'pending'
          and i.expires_at <= now()
          and i.cleanup_status = 'waiting'
        order by i.expires_at, i.id
        limit 100
        for update skip locked
    )
    update public.recipe_image_upload_intents i
    set state = 'expired',
        cleanup_status = 'queued',
        cleanup_next_attempt_at = now()
    from expired e
    where i.id = e.id;

    update public.recipe_image_upload_intents
    set cleanup_status = 'failed',
        cleanup_lease_until = null,
        cleanup_next_attempt_at = null,
        cleanup_last_error = 'unexpected'
    where state = 'expired'
      and cleanup_status = 'claimed'
      and cleanup_attempts >= 8
      and cleanup_lease_until <= now();

    return query
    with candidates as (
        select i.id
        from public.recipe_image_upload_intents i
        where i.state = 'expired'
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
    where id = p_id and state = 'expired'
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
        count(*) filter (where cleanup_status <> 'failed'),
        count(*) filter (where cleanup_status = 'failed')
    into v_pending, v_failed
    from public.recipe_image_upload_intents
    where state = 'expired'
      and cleanup_status <> 'complete';

    return jsonb_build_object('pending', v_pending, 'failed', v_failed);
end;
$$;

revoke all on function public.create_recipe_image_upload_intent(uuid, uuid, uuid, text, text, text, integer, timestamptz, timestamptz) from public;
revoke all on function public.claim_expired_recipe_image_uploads(integer) from public;
revoke all on function public.finish_recipe_image_upload_cleanup(uuid, boolean, text) from public;
revoke all on function public.recipe_image_upload_cleanup_health() from public;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        execute 'revoke all on function public.create_recipe_image_upload_intent(uuid, uuid, uuid, text, text, text, integer, timestamptz, timestamptz) from anon';
        execute 'revoke all on function public.claim_expired_recipe_image_uploads(integer) from anon';
        execute 'revoke all on function public.finish_recipe_image_upload_cleanup(uuid, boolean, text) from anon';
        execute 'revoke all on function public.recipe_image_upload_cleanup_health() from anon';
        execute 'revoke all on table public.recipe_image_upload_intents from anon';
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
        execute 'revoke all on function public.create_recipe_image_upload_intent(uuid, uuid, uuid, text, text, text, integer, timestamptz, timestamptz) from authenticated';
        execute 'revoke all on function public.claim_expired_recipe_image_uploads(integer) from authenticated';
        execute 'revoke all on function public.finish_recipe_image_upload_cleanup(uuid, boolean, text) from authenticated';
        execute 'revoke all on function public.recipe_image_upload_cleanup_health() from authenticated';
        execute 'revoke all on table public.recipe_image_upload_intents from authenticated';
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
        execute 'revoke all on table public.recipe_image_upload_intents from service_role';
        execute 'grant select on table public.recipe_image_upload_intents to service_role';
        execute 'grant execute on function public.create_recipe_image_upload_intent(uuid, uuid, uuid, text, text, text, integer, timestamptz, timestamptz) to service_role';
        execute 'grant execute on function public.claim_expired_recipe_image_uploads(integer) to service_role';
        execute 'grant execute on function public.finish_recipe_image_upload_cleanup(uuid, boolean, text) to service_role';
        execute 'grant execute on function public.recipe_image_upload_cleanup_health() to service_role';
    end if;
end;
$$;
