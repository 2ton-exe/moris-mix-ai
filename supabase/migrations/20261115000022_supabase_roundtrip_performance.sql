create index if not exists recipe_image_upload_intents_user_created_idx
    on public.recipe_image_upload_intents (user_id, created_at desc);

create index if not exists recipe_image_upload_intents_open_user_idx
    on public.recipe_image_upload_intents (user_id)
    where cleanup_status <> 'complete';

drop index if exists public.idx_lineage_child;
create index idx_lineage_child
    on public.recipe_lineage (child_recipe_id, created_at, id);

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
    for select using ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
    for update using ((select auth.uid()) = id)
    with check ((select auth.uid()) = id);

drop policy if exists "recipes_select_own" on public.recipes;
create policy "recipes_select_own" on public.recipes
    for select using ((select auth.uid()) = user_id);

drop policy if exists "recipes_insert_own" on public.recipes;
create policy "recipes_insert_own" on public.recipes
    for insert with check ((select auth.uid()) = user_id);

drop policy if exists "recipes_update_own" on public.recipes;
create policy "recipes_update_own" on public.recipes
    for update using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

drop policy if exists "recipes_delete_own" on public.recipes;
create policy "recipes_delete_own" on public.recipes
    for delete using ((select auth.uid()) = user_id);

drop policy if exists "lineage_select_own" on public.recipe_lineage;
create policy "lineage_select_own" on public.recipe_lineage
    for select using (
        exists (
            select 1 from public.recipes
            where id = public.recipe_lineage.parent_recipe_id
              and user_id = (select auth.uid())
        )
    );

drop policy if exists "lineage_insert_own" on public.recipe_lineage;
create policy "lineage_insert_own" on public.recipe_lineage
    for insert with check (
        exists (
            select 1 from public.recipes
            where id = public.recipe_lineage.parent_recipe_id
              and user_id = (select auth.uid())
        ) and exists (
            select 1 from public.recipes
            where id = public.recipe_lineage.child_recipe_id
              and user_id = (select auth.uid())
        )
    );

drop policy if exists "lineage_delete_own" on public.recipe_lineage;
create policy "lineage_delete_own" on public.recipe_lineage
    for delete using (
        exists (
            select 1 from public.recipes
            where id = public.recipe_lineage.parent_recipe_id
              and user_id = (select auth.uid())
        )
    );

drop policy if exists "ai_usage_select_own" on public.ai_usage_daily;
create policy "ai_usage_select_own" on public.ai_usage_daily
    for select using ((select auth.uid()) = user_id);

create or replace function public.create_recipe_image_upload_intent_v2(
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
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Unauthorized upload intent operation' using errcode = '42501';
    end if;

    perform 1 from public.recipes
    where id = p_recipe_id and user_id = p_user_id
    for share;
    if not found then return 'recipe_not_found'; end if;

    return public.create_recipe_image_upload_intent(
        p_id, p_user_id, p_recipe_id, p_staging_key, p_final_key,
        p_content_type, p_byte_size, p_created_at, p_expires_at
    );
end;
$$;

revoke all on function public.create_recipe_image_upload_intent_v2(uuid, uuid, uuid, text, text, text, integer, timestamptz, timestamptz) from public;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        execute 'revoke all on function public.create_recipe_image_upload_intent_v2(uuid, uuid, uuid, text, text, text, integer, timestamptz, timestamptz) from anon';
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
        execute 'revoke all on function public.create_recipe_image_upload_intent_v2(uuid, uuid, uuid, text, text, text, integer, timestamptz, timestamptz) from authenticated';
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
        execute 'grant execute on function public.create_recipe_image_upload_intent_v2(uuid, uuid, uuid, text, text, text, integer, timestamptz, timestamptz) to service_role';
    end if;
end;
$$;
