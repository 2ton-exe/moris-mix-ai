create or replace function public.resolve_recipe_image_download(
    p_user_id uuid,
    p_recipe_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_key text;
    v_content_type text;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Unauthorized recipe image read resolution' using errcode = '42501';
    end if;
    select recipe.image_path into v_key
    from public.recipes as recipe
    where recipe.id = p_recipe_id and recipe.user_id = p_user_id;
    if not found then return jsonb_build_object('status', 'recipe_not_found'); end if;
    if v_key is null then return jsonb_build_object('status', 'image_not_found'); end if;
    select attempt.content_type into v_content_type
    from public.recipe_image_finalization_attempts as attempt
    where attempt.user_id = p_user_id and attempt.recipe_id = p_recipe_id
      and attempt.object_key = v_key and attempt.state = 'attached';
    if not found or v_content_type is null or v_content_type not in ('image/jpeg', 'image/png', 'image/webp') then
        return jsonb_build_object('status', 'image_not_found');
    end if;
    return jsonb_build_object('status', 'found', 'object_key', v_key, 'content_type', v_content_type);
end;
$$;

revoke all on function public.resolve_recipe_image_download(uuid, uuid) from public;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        execute 'revoke all on function public.resolve_recipe_image_download(uuid, uuid) from anon';
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
        execute 'revoke all on function public.resolve_recipe_image_download(uuid, uuid) from authenticated';
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
        execute 'grant execute on function public.resolve_recipe_image_download(uuid, uuid) to service_role';
    end if;
end;
$$;
