alter table public.recipe_image_upload_intents
    add column upload_reservation uuid;

create function public.claim_recipe_image_upload_reservation(p_id uuid, p_user_id uuid, p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Unauthorized upload reservation operation' using errcode = '42501';
    end if;
    if p_token is null then
        return false;
    end if;
    update public.recipe_image_upload_intents
    set upload_reservation = p_token
    where id = p_id and user_id = p_user_id
      and state = 'pending' and cleanup_status = 'waiting'
      and expires_at > clock_timestamp() + interval '30 seconds'
      and upload_reservation is null;
    return found;
end;
$$;

create function public.release_recipe_image_upload_reservation(p_id uuid, p_user_id uuid, p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Unauthorized upload reservation operation' using errcode = '42501';
    end if;
    update public.recipe_image_upload_intents
    set upload_reservation = null
    where id = p_id and user_id = p_user_id and upload_reservation = p_token;
    return found;
end;
$$;

revoke all on function public.claim_recipe_image_upload_reservation(uuid, uuid, uuid) from public;
revoke all on function public.release_recipe_image_upload_reservation(uuid, uuid, uuid) from public;

do $$
declare
    v_role text;
begin
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
        if exists (select 1 from pg_roles where rolname = v_role) then
            execute format('revoke all on function public.claim_recipe_image_upload_reservation(uuid, uuid, uuid) from %I', v_role);
            execute format('revoke all on function public.release_recipe_image_upload_reservation(uuid, uuid, uuid) from %I', v_role);
        end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
        grant execute on function public.claim_recipe_image_upload_reservation(uuid, uuid, uuid) to service_role;
        grant execute on function public.release_recipe_image_upload_reservation(uuid, uuid, uuid) to service_role;
    end if;
end;
$$;
