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
    where state = 'expired'
      and cleanup_status <> 'complete';

    return jsonb_build_object('pending', v_pending, 'failed', v_failed);
end;
$$;
