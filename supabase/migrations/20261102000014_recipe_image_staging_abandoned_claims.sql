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
