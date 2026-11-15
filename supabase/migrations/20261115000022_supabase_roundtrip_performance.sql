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
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_status text;
    v_intent jsonb;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Unauthorized upload intent operation' using errcode = '42501';
    end if;

    perform pg_advisory_xact_lock(hashtext('recipe-image-upload:' || p_user_id::text));
    -- Match finalization's intent-before-recipe lock order on idempotent retries.
    perform 1 from public.recipe_image_upload_intents where id = p_id for update;
    perform 1 from public.recipes
    where id = p_recipe_id and user_id = p_user_id
    for share;
    if not found then return jsonb_build_object('status', 'recipe_not_found'); end if;

    v_status := public.create_recipe_image_upload_intent(
        p_id, p_user_id, p_recipe_id, p_staging_key, p_final_key,
        p_content_type, p_byte_size, p_created_at, p_expires_at
    );
    if v_status is distinct from 'allowed' then
        return jsonb_build_object('status', v_status);
    end if;

    select jsonb_build_object(
        'id', intent.id,
        'user_id', intent.user_id,
        'recipe_id', intent.recipe_id,
        'staging_key', intent.staging_key,
        'final_key', intent.final_key,
        'content_type', intent.content_type,
        'byte_size', intent.byte_size,
        'created_at', intent.created_at,
        'expires_at', intent.expires_at,
        'state', intent.state,
        'cleanup_status', intent.cleanup_status
    ) into v_intent
    from public.recipe_image_upload_intents as intent
    where intent.id = p_id and intent.user_id = p_user_id;

    if v_intent is null then
        raise exception 'Upload intent persistence failed';
    end if;
    return jsonb_build_object('status', 'allowed', 'intent', v_intent);
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
