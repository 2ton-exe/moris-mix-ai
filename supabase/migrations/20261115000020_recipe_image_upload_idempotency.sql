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
    v_existing public.recipe_image_upload_intents%rowtype;
    v_hourly_count integer;
    v_outstanding_count integer;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Unauthorized upload intent operation' using errcode = '42501';
    end if;

    perform pg_advisory_xact_lock(hashtext('recipe-image-upload:' || p_user_id::text));

    select * into v_existing
    from public.recipe_image_upload_intents
    where id = p_id
    for update;

    if found then
        if v_existing.user_id = p_user_id
          and v_existing.recipe_id = p_recipe_id
          and v_existing.content_type = p_content_type
          and v_existing.byte_size = p_byte_size
          and v_existing.state = 'pending'
          and v_existing.cleanup_status = 'waiting'
          and v_existing.expires_at > clock_timestamp() + interval '30 seconds' then
            return 'allowed';
        end if;
        return 'conflict';
    end if;

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
