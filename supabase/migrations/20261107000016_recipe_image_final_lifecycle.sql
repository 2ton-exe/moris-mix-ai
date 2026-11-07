alter table public.recipe_image_upload_intents
    add column finalization_attempt_token uuid,
    add column finalization_lease_until timestamptz,
    add column finalized_content_type text,
    add column finalized_byte_size integer,
    add column finalized_object_key text,
    add column finalized_at timestamptz,
    add constraint recipe_image_upload_intents_finalization_state_check check (
        (state = 'finalizing' and finalization_attempt_token is not null and finalization_lease_until is not null)
        or (state <> 'finalizing' and finalization_attempt_token is null and finalization_lease_until is null)
    ),
    add constraint recipe_image_upload_intents_finalized_result_check check (
        (state = 'attached' and (
            (finalized_content_type is null and finalized_byte_size is null and finalized_object_key is null and finalized_at is null)
            or (finalized_content_type = content_type and finalized_byte_size = byte_size and finalized_object_key ~ '^recipe-images/final/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and finalized_at is not null)
        ))
        or (state <> 'attached' and finalized_content_type is null and finalized_byte_size is null and finalized_object_key is null and finalized_at is null)
    );

create table public.recipe_image_final_cleanup (
    object_key text primary key check (
        object_key ~ '^recipe-images/final/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/){3}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$'
    ),
    recipe_id uuid,
    upload_intent_id uuid,
    status text not null default 'queued' check (status in ('active', 'queued', 'claimed', 'retry', 'watching', 'complete', 'failed')),
    attempts integer not null default 0 check (attempts between 0 and 8),
    watch_late_writes boolean not null default false,
    lease_token uuid,
    lease_until timestamptz,
    next_attempt_at timestamptz not null default now(),
    completed_at timestamptz,
    last_error text check (last_error is null or last_error in ('configuration', 'network', 'r2_rejected', 'r2_unavailable', 'unexpected')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check ((status = 'claimed') = (lease_token is not null and lease_until is not null)),
    check ((status = 'complete') = (completed_at is not null)),
    check (status <> 'failed' or attempts = 8),
    check (status <> 'watching' or watch_late_writes)
);

create table public.recipe_image_finalization_attempts (
    attempt_token uuid primary key,
    upload_intent_id uuid not null,
    user_id uuid not null,
    recipe_id uuid not null,
    object_key text not null unique check (
        object_key ~ '^recipe-images/final/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ),
    state text not null check (state in ('claimed', 'copying', 'verified', 'attached', 'abandoned')),
    content_type text check (content_type is null or content_type in ('image/jpeg', 'image/png', 'image/webp')),
    byte_size integer check (byte_size is null or byte_size between 1 and 10485760),
    copy_started_at timestamptz,
    copy_completed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check ((state in ('verified', 'attached') and content_type is not null and byte_size is not null and copy_completed_at is not null) or (state not in ('verified', 'attached') and content_type is null and byte_size is null and copy_completed_at is null)),
    check (state <> 'claimed' or copy_started_at is null),
    check (state <> 'copying' or copy_started_at is not null)
);

alter table public.recipe_image_final_cleanup enable row level security;
alter table public.recipe_image_final_cleanup force row level security;
alter table public.recipe_image_finalization_attempts enable row level security;
alter table public.recipe_image_finalization_attempts force row level security;
revoke all on table public.recipe_image_final_cleanup from public;
revoke all on table public.recipe_image_finalization_attempts from public;
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        execute 'revoke all on table public.recipe_image_final_cleanup from anon';
        execute 'revoke all on table public.recipe_image_finalization_attempts from anon';
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
        execute 'revoke all on table public.recipe_image_final_cleanup from authenticated';
        execute 'revoke all on table public.recipe_image_finalization_attempts from authenticated';
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
        execute 'revoke all on table public.recipe_image_final_cleanup from service_role';
        execute 'revoke all on table public.recipe_image_finalization_attempts from service_role';
    end if;
end;
$$;

create index recipe_image_finalization_attempts_recovery_idx
    on public.recipe_image_finalization_attempts (upload_intent_id, state);

create index recipe_image_final_cleanup_claim_idx
    on public.recipe_image_final_cleanup (status, next_attempt_at, created_at);

create or replace function public.enqueue_recipe_image_final_cleanup(
    p_object_key text,
    p_recipe_id uuid,
    p_upload_intent_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
    if p_object_key is null or p_object_key !~ '^recipe-images/final/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/){3}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$' then
        return;
    end if;
    insert into public.recipe_image_final_cleanup (object_key, recipe_id, upload_intent_id)
    values (p_object_key, p_recipe_id, p_upload_intent_id)
    on conflict (object_key) do update
    set status = 'queued', attempts = 0, watch_late_writes = false,
        lease_token = null, lease_until = null, next_attempt_at = now(),
        completed_at = null, last_error = null, updated_at = now();
end;
$$;

create or replace function public.abandon_recipe_image_finalization_attempt(
    p_attempt_token uuid,
    p_copy_outcome text
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_attempt public.recipe_image_finalization_attempts%rowtype;
    v_watch boolean;
    v_no_copy boolean;
begin
    select * into v_attempt
    from public.recipe_image_finalization_attempts as attempt
    where attempt.attempt_token = p_attempt_token
    for update;
    if not found or v_attempt.state in ('attached', 'abandoned') then return; end if;

    if p_copy_outcome is null or p_copy_outcome not in ('not_started', 'complete', 'uncertain') then
        raise exception 'Invalid recipe image copy outcome' using errcode = '22023';
    end if;
    v_no_copy := v_attempt.state = 'claimed';
    v_watch := p_copy_outcome <> 'complete' and not v_no_copy and v_attempt.state = 'copying';

    update public.recipe_image_finalization_attempts
    set state = 'abandoned', content_type = null, byte_size = null,
        copy_completed_at = null, updated_at = now()
    where attempt_token = p_attempt_token;

    update public.recipe_image_final_cleanup
    set status = case when v_no_copy then 'complete' when v_watch then 'watching' else 'queued' end,
        attempts = 0, watch_late_writes = v_watch,
        lease_token = null, lease_until = null,
        next_attempt_at = now(),
        completed_at = case when v_no_copy then now() else null end,
        last_error = null, updated_at = now()
    where object_key = v_attempt.object_key and status = 'active';
end;
$$;

create or replace function public.guard_recipe_image_path_write()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
    if current_user in ('anon', 'authenticated') and (
        (tg_op = 'INSERT' and new.image_path is not null)
        or (tg_op = 'UPDATE' and new.image_path is distinct from old.image_path)
    ) then
        raise exception 'Recipe image path is managed by the image lifecycle' using errcode = '42501';
    end if;
    return new;
end;
$$;

drop trigger if exists tr_recipes_guard_image_path_write on public.recipes;
create trigger tr_recipes_guard_image_path_write
    before insert or update on public.recipes
    for each row execute function public.guard_recipe_image_path_write();

create or replace function public.enqueue_replaced_recipe_image()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
    if old.image_path is distinct from new.image_path then
        perform public.enqueue_recipe_image_final_cleanup(old.image_path, old.id, null);
    end if;
    return new;
end;
$$;

create or replace function public.enqueue_deleted_recipe_image()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
    perform public.enqueue_recipe_image_final_cleanup(old.image_path, old.id, null);
    return old;
end;
$$;

drop trigger if exists tr_recipes_enqueue_replaced_image on public.recipes;
create trigger tr_recipes_enqueue_replaced_image
    after update of image_path on public.recipes
    for each row execute function public.enqueue_replaced_recipe_image();

drop trigger if exists tr_recipes_enqueue_deleted_image on public.recipes;
create trigger tr_recipes_enqueue_deleted_image
    before delete on public.recipes
    for each row execute function public.enqueue_deleted_recipe_image();

create or replace function public.enqueue_expired_recipe_image_final()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_attempt_token uuid;
begin
    if new.state = 'expired' and old.state in ('pending', 'finalizing') then
        for v_attempt_token in
            select attempt.attempt_token
            from public.recipe_image_finalization_attempts as attempt
            where attempt.upload_intent_id = new.id
              and attempt.state in ('claimed', 'copying', 'verified')
        loop
            perform public.abandon_recipe_image_finalization_attempt(v_attempt_token, 'uncertain');
        end loop;
    end if;
    return new;
end;
$$;

drop trigger if exists tr_recipe_image_enqueue_expired_final on public.recipe_image_upload_intents;
create trigger tr_recipe_image_enqueue_expired_final
    after update of state on public.recipe_image_upload_intents
    for each row execute function public.enqueue_expired_recipe_image_final();

create or replace function public.enqueue_deleted_recipe_image_finalization()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_attempt_token uuid;
begin
    for v_attempt_token in
        select attempt.attempt_token
        from public.recipe_image_finalization_attempts as attempt
        where attempt.upload_intent_id = old.id
          and attempt.state in ('claimed', 'copying', 'verified')
    loop
        perform public.abandon_recipe_image_finalization_attempt(v_attempt_token, 'uncertain');
    end loop;
    return old;
end;
$$;

drop trigger if exists tr_recipe_image_enqueue_deleted_finalization on public.recipe_image_upload_intents;
create trigger tr_recipe_image_enqueue_deleted_finalization
    before delete on public.recipe_image_upload_intents
    for each row execute function public.enqueue_deleted_recipe_image_finalization();

create or replace function public.claim_recipe_image_finalization(
    p_user_id uuid,
    p_recipe_id uuid,
    p_upload_id uuid,
    p_attempt_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_intent public.recipe_image_upload_intents%rowtype;
    v_object_key text;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Unauthorized recipe image finalization operation' using errcode = '42501';
    end if;
    if p_user_id is null or p_recipe_id is null or p_upload_id is null or p_attempt_token is null then
        raise exception 'Invalid recipe image finalization request' using errcode = '22023';
    end if;

    select * into v_intent
    from public.recipe_image_upload_intents as intent
    where intent.id = p_upload_id
      and intent.user_id = p_user_id
      and intent.recipe_id = p_recipe_id
    for update;

    if not found or not exists (
        select 1 from public.recipes as recipe
        where recipe.id = p_recipe_id and recipe.user_id = p_user_id
    ) then
        return jsonb_build_object('status', 'not_found');
    end if;

    if v_intent.state = 'attached' then
        return jsonb_build_object(
            'status', 'attached',
            'content_type', v_intent.finalized_content_type,
            'byte_size', v_intent.finalized_byte_size,
            'uploaded_at', v_intent.finalized_at
        );
    end if;

    if v_intent.state = 'pending' and v_intent.expires_at <= now() then
        return jsonb_build_object('status', 'not_found');
    end if;

    if v_intent.state = 'finalizing' and v_intent.finalization_lease_until > now() then
        return jsonb_build_object('status', 'conflict');
    end if;

    if v_intent.state not in ('pending', 'finalizing') then
        return jsonb_build_object('status', 'not_found');
    end if;

    if v_intent.state = 'finalizing' then
        perform public.abandon_recipe_image_finalization_attempt(v_intent.finalization_attempt_token, 'uncertain');
    end if;

    v_object_key := v_intent.final_key || '/' || p_attempt_token::text;

    insert into public.recipe_image_finalization_attempts (
        attempt_token, upload_intent_id, user_id, recipe_id, object_key, state
    ) values (
        p_attempt_token, v_intent.id, v_intent.user_id, v_intent.recipe_id,
        v_object_key, 'claimed'
    );

    insert into public.recipe_image_final_cleanup (
        object_key, recipe_id, upload_intent_id, status
    ) values (v_object_key, v_intent.recipe_id, v_intent.id, 'active');

    update public.recipe_image_upload_intents
    set state = 'finalizing',
        finalization_attempt_token = p_attempt_token,
        finalization_lease_until = now() + interval '2 minutes'
    where id = p_upload_id;

    return jsonb_build_object(
        'status', 'claimed',
        'id', v_intent.id,
        'user_id', v_intent.user_id,
        'recipe_id', v_intent.recipe_id,
        'staging_key', v_intent.staging_key,
        'object_key', v_object_key,
        'content_type', v_intent.content_type,
        'byte_size', v_intent.byte_size,
        'expires_at', v_intent.expires_at,
        'attempt_token', p_attempt_token
    );
end;
$$;

create or replace function public.start_recipe_image_final_copy(
    p_upload_id uuid,
    p_attempt_token uuid
)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_intent public.recipe_image_upload_intents%rowtype;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Unauthorized recipe image copy operation' using errcode = '42501';
    end if;
    select * into v_intent
    from public.recipe_image_upload_intents as intent
    where intent.id = p_upload_id
    for update;
    if not found or v_intent.state <> 'finalizing'
       or v_intent.finalization_attempt_token is distinct from p_attempt_token
       or v_intent.finalization_lease_until <= now() then
        perform public.abandon_recipe_image_finalization_attempt(p_attempt_token, 'not_started');
        return 'stale';
    end if;
    update public.recipe_image_finalization_attempts
    set state = 'copying', copy_started_at = now(), updated_at = now()
    where attempt_token = p_attempt_token and upload_intent_id = p_upload_id and state = 'claimed';
    if not found then return 'stale'; end if;
    update public.recipe_image_final_cleanup
    set watch_late_writes = true, updated_at = now()
    where object_key = (
        select attempt.object_key from public.recipe_image_finalization_attempts as attempt
        where attempt.attempt_token = p_attempt_token
    ) and status = 'active';
    return 'started';
end;
$$;

create or replace function public.finish_recipe_image_final_copy(
    p_upload_id uuid,
    p_attempt_token uuid,
    p_content_type text,
    p_byte_size integer
)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_intent public.recipe_image_upload_intents%rowtype;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Unauthorized recipe image copy result' using errcode = '42501';
    end if;
    if p_content_type is null or p_content_type not in ('image/jpeg', 'image/png', 'image/webp')
       or p_byte_size is null or p_byte_size not between 1 and 10485760 then
        raise exception 'Invalid verified recipe image metadata' using errcode = '22023';
    end if;
    select * into v_intent
    from public.recipe_image_upload_intents as intent
    where intent.id = p_upload_id
    for update;
    if not found or v_intent.state <> 'finalizing'
       or v_intent.finalization_attempt_token is distinct from p_attempt_token
       or v_intent.finalization_lease_until <= now()
       or v_intent.content_type <> p_content_type
       or v_intent.byte_size <> p_byte_size then
        perform public.abandon_recipe_image_finalization_attempt(p_attempt_token, 'complete');
        return 'stale';
    end if;
    update public.recipe_image_finalization_attempts
    set state = 'verified', content_type = p_content_type, byte_size = p_byte_size,
        copy_completed_at = now(), updated_at = now()
    where attempt_token = p_attempt_token and upload_intent_id = p_upload_id and state = 'copying';
    if not found then return 'stale'; end if;
    update public.recipe_image_final_cleanup
    set watch_late_writes = false, updated_at = now()
    where object_key = (
        select attempt.object_key from public.recipe_image_finalization_attempts as attempt
        where attempt.attempt_token = p_attempt_token
    ) and status = 'active';
    return 'verified';
end;
$$;

create or replace function public.finish_recipe_image_finalization(
    p_user_id uuid,
    p_recipe_id uuid,
    p_upload_id uuid,
    p_attempt_token uuid,
    p_content_type text,
    p_byte_size integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_intent public.recipe_image_upload_intents%rowtype;
    v_attempt public.recipe_image_finalization_attempts%rowtype;
    v_previous_key text;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Unauthorized recipe image attachment operation' using errcode = '42501';
    end if;
    if p_content_type is null or p_content_type not in ('image/jpeg', 'image/png', 'image/webp') or p_byte_size is null or p_byte_size not between 1 and 10485760 then
        raise exception 'Invalid verified recipe image metadata' using errcode = '22023';
    end if;

    select * into v_intent from public.recipe_image_upload_intents as intent
    where intent.id = p_upload_id and intent.user_id = p_user_id and intent.recipe_id = p_recipe_id
    for update;
    if not found or v_intent.state <> 'finalizing'
       or v_intent.finalization_attempt_token is distinct from p_attempt_token
       or v_intent.finalization_lease_until <= now()
       or v_intent.content_type <> p_content_type
       or v_intent.byte_size <> p_byte_size then
        return jsonb_build_object('status', 'stale');
    end if;

    select * into v_attempt from public.recipe_image_finalization_attempts as attempt
    where attempt.attempt_token = p_attempt_token
      and attempt.upload_intent_id = p_upload_id
      and attempt.user_id = p_user_id
      and attempt.recipe_id = p_recipe_id
      and attempt.state = 'verified'
      and attempt.content_type = p_content_type
      and attempt.byte_size = p_byte_size
    for update;
    if not found then return jsonb_build_object('status', 'stale'); end if;

    select recipe.image_path into v_previous_key
    from public.recipes as recipe
    where recipe.id = p_recipe_id and recipe.user_id = p_user_id
    for update;
    if not found then
        perform public.abandon_recipe_image_finalization_attempt(p_attempt_token, 'complete');
        return jsonb_build_object('status', 'not_found');
    end if;

    update public.recipes
    set image_path = v_attempt.object_key
    where id = p_recipe_id and user_id = p_user_id;

    update public.recipe_image_upload_intents
    set state = 'attached',
        finalization_attempt_token = null,
        finalization_lease_until = null,
        finalized_content_type = p_content_type,
        finalized_byte_size = p_byte_size,
        finalized_object_key = v_attempt.object_key,
        finalized_at = now()
    where id = p_upload_id;

    update public.recipe_image_finalization_attempts
    set state = 'attached', updated_at = now()
    where attempt_token = p_attempt_token;

    return jsonb_build_object(
        'status', 'attached',
        'content_type', p_content_type,
        'byte_size', p_byte_size,
        'uploaded_at', (select finalized_at from public.recipe_image_upload_intents where id = p_upload_id),
        'object_key', v_attempt.object_key,
        'previous_key', v_previous_key
    );
end;
$$;

create or replace function public.release_recipe_image_finalization(
    p_upload_id uuid,
    p_attempt_token uuid,
    p_copy_outcome text default 'uncertain'
)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_intent public.recipe_image_upload_intents%rowtype;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Unauthorized recipe image finalization recovery' using errcode = '42501';
    end if;
    if p_copy_outcome is null or p_copy_outcome not in ('not_started', 'complete', 'uncertain') then
        raise exception 'Invalid recipe image copy outcome' using errcode = '22023';
    end if;
    select * into v_intent from public.recipe_image_upload_intents where id = p_upload_id for update;
    if not found then
        perform public.abandon_recipe_image_finalization_attempt(p_attempt_token, p_copy_outcome);
        return 'stale';
    end if;
    perform public.abandon_recipe_image_finalization_attempt(p_attempt_token, p_copy_outcome);
    if v_intent.state <> 'finalizing' or v_intent.finalization_attempt_token is distinct from p_attempt_token then
        return 'stale';
    end if;
    if v_intent.expires_at <= now() then
        update public.recipe_image_upload_intents
        set state = 'expired', finalization_attempt_token = null, finalization_lease_until = null,
            cleanup_status = 'queued', cleanup_next_attempt_at = now()
        where id = p_upload_id;
        return 'expired';
    end if;
    update public.recipe_image_upload_intents
    set state = 'pending', finalization_attempt_token = null, finalization_lease_until = null
    where id = p_upload_id;
    return 'pending';
end;
$$;

create or replace function public.delete_recipe_image_association(
    p_user_id uuid,
    p_recipe_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_found boolean;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Unauthorized recipe image deletion' using errcode = '42501';
    end if;
    if p_user_id is null or p_recipe_id is null then
        raise exception 'Invalid recipe image deletion request' using errcode = '22023';
    end if;
    select true into v_found from public.recipes
    where id = p_recipe_id and user_id = p_user_id for update;
    if not coalesce(v_found, false) then return 'not_found'; end if;
    update public.recipes set image_path = null
    where id = p_recipe_id and user_id = p_user_id and image_path is not null;
    return 'deleted';
end;
$$;

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
    if not found or v_key is null then return jsonb_build_object('status', 'not_found'); end if;
    select attempt.content_type into v_content_type
    from public.recipe_image_finalization_attempts as attempt
    where attempt.user_id = p_user_id and attempt.recipe_id = p_recipe_id
      and attempt.object_key = v_key and attempt.state = 'attached';
    if v_content_type not in ('image/jpeg', 'image/png', 'image/webp') then
        return jsonb_build_object('status', 'not_found');
    end if;
    return jsonb_build_object('status', 'found', 'object_key', v_key, 'content_type', v_content_type);
end;
$$;

create or replace function public.claim_recipe_image_final_cleanup(p_limit integer default 25)
returns table (object_key text, lease_token uuid)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_recover record;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Unauthorized finalized image cleanup' using errcode = '42501';
    end if;

    for v_recover in
        select intent.id, intent.finalization_attempt_token, intent.expires_at
        from public.recipe_image_upload_intents as intent
        where intent.state = 'finalizing' and intent.finalization_lease_until <= now()
        order by intent.finalization_lease_until, intent.id
        limit 100
        for update skip locked
    loop
        perform public.abandon_recipe_image_finalization_attempt(v_recover.finalization_attempt_token, 'uncertain');
        update public.recipe_image_upload_intents
        set state = case when v_recover.expires_at <= now() then 'expired' else 'pending' end,
            finalization_attempt_token = null,
            finalization_lease_until = null,
            cleanup_status = case when v_recover.expires_at <= now() then 'queued' else 'waiting' end,
            cleanup_next_attempt_at = case when v_recover.expires_at <= now() then now() else null end
        where id = v_recover.id;
    end loop;

    update public.recipe_image_final_cleanup
    set status = case when watch_late_writes then 'watching' else 'failed' end,
        attempts = case when watch_late_writes then 0 else attempts end,
        lease_token = null, lease_until = null,
        next_attempt_at = case when watch_late_writes then now() + interval '1 hour' else now() end,
        last_error = 'unexpected', updated_at = now()
    where status = 'claimed' and lease_until <= now() and attempts >= 8;

    return query
    with candidates as (
        select cleanup.object_key
        from public.recipe_image_final_cleanup as cleanup
        where cleanup.status in ('queued', 'retry', 'claimed', 'watching')
          and cleanup.attempts < 8
          and cleanup.next_attempt_at <= now()
          and (cleanup.lease_until is null or cleanup.lease_until <= now())
          and not exists (select 1 from public.recipes as recipe where recipe.image_path = cleanup.object_key)
        order by cleanup.next_attempt_at, cleanup.created_at, cleanup.object_key
        limit least(greatest(coalesce(p_limit, 25), 1), 50)
        for update skip locked
    ), claimed as (
        update public.recipe_image_final_cleanup as cleanup
        set status = 'claimed', attempts = cleanup.attempts + 1,
            lease_token = gen_random_uuid(), lease_until = now() + interval '10 minutes',
            next_attempt_at = now(), completed_at = null, updated_at = now()
        from candidates
        where cleanup.object_key = candidates.object_key
        returning cleanup.object_key, cleanup.lease_token
    )
    select claimed.object_key, claimed.lease_token from claimed;
end;
$$;

create or replace function public.finish_recipe_image_final_cleanup(
    p_object_key text,
    p_lease_token uuid,
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
    v_watch boolean;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Unauthorized finalized image cleanup result' using errcode = '42501';
    end if;
    select attempts, watch_late_writes into v_attempts, v_watch from public.recipe_image_final_cleanup
    where object_key = p_object_key and status = 'claimed' and lease_token = p_lease_token and lease_until > now()
    for update;
    if not found then return 'stale'; end if;
    if p_success then
        if v_watch then
            update public.recipe_image_final_cleanup set status = 'watching', attempts = 0,
                lease_token = null, lease_until = null,
                next_attempt_at = now() + interval '1 hour', completed_at = null,
                last_error = null, updated_at = now()
            where object_key = p_object_key;
            return 'watching';
        end if;
        update public.recipe_image_final_cleanup set status = 'complete', lease_token = null, lease_until = null,
            next_attempt_at = now(), completed_at = now(), last_error = null, updated_at = now()
        where object_key = p_object_key;
        return 'complete';
    end if;
    if p_failure is null or p_failure not in ('configuration', 'network', 'r2_rejected', 'r2_unavailable', 'unexpected') then
        raise exception 'Invalid finalized image cleanup failure' using errcode = '22023';
    end if;
    update public.recipe_image_final_cleanup set
        status = case when v_watch and v_attempts >= 8 then 'watching' when v_attempts >= 8 then 'failed' else 'retry' end,
        attempts = case when v_watch and v_attempts >= 8 then 0 else v_attempts end,
        lease_token = null, lease_until = null,
        next_attempt_at = case when v_watch and v_attempts >= 8 then now() + interval '1 hour' when v_attempts >= 8 then now() else now() + make_interval(mins => least(60, power(2, least(v_attempts, 6))::integer)) end,
        last_error = p_failure, updated_at = now()
    where object_key = p_object_key;
    return case when v_watch and v_attempts >= 8 then 'watching' when v_attempts >= 8 then 'failed' else 'retry' end;
end;
$$;

revoke all on function public.enqueue_recipe_image_final_cleanup(text, uuid, uuid) from public;
revoke all on function public.abandon_recipe_image_finalization_attempt(uuid, text) from public;
revoke all on function public.guard_recipe_image_path_write() from public;
revoke all on function public.enqueue_replaced_recipe_image() from public;
revoke all on function public.enqueue_deleted_recipe_image() from public;
revoke all on function public.enqueue_expired_recipe_image_final() from public;
revoke all on function public.enqueue_deleted_recipe_image_finalization() from public;
revoke all on function public.claim_recipe_image_finalization(uuid, uuid, uuid, uuid) from public;
revoke all on function public.start_recipe_image_final_copy(uuid, uuid) from public;
revoke all on function public.finish_recipe_image_final_copy(uuid, uuid, text, integer) from public;
revoke all on function public.finish_recipe_image_finalization(uuid, uuid, uuid, uuid, text, integer) from public;
revoke all on function public.release_recipe_image_finalization(uuid, uuid, text) from public;
revoke all on function public.delete_recipe_image_association(uuid, uuid) from public;
revoke all on function public.resolve_recipe_image_download(uuid, uuid) from public;
revoke all on function public.claim_recipe_image_final_cleanup(integer) from public;
revoke all on function public.finish_recipe_image_final_cleanup(text, uuid, boolean, text) from public;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        execute 'revoke all on function public.enqueue_recipe_image_final_cleanup(text, uuid, uuid) from anon';
        execute 'revoke all on function public.abandon_recipe_image_finalization_attempt(uuid, text) from anon';
        execute 'revoke all on function public.claim_recipe_image_finalization(uuid, uuid, uuid, uuid) from anon';
        execute 'revoke all on function public.start_recipe_image_final_copy(uuid, uuid) from anon';
        execute 'revoke all on function public.finish_recipe_image_final_copy(uuid, uuid, text, integer) from anon';
        execute 'revoke all on function public.finish_recipe_image_finalization(uuid, uuid, uuid, uuid, text, integer) from anon';
        execute 'revoke all on function public.release_recipe_image_finalization(uuid, uuid, text) from anon';
        execute 'revoke all on function public.delete_recipe_image_association(uuid, uuid) from anon';
        execute 'revoke all on function public.resolve_recipe_image_download(uuid, uuid) from anon';
        execute 'revoke all on function public.claim_recipe_image_final_cleanup(integer) from anon';
        execute 'revoke all on function public.finish_recipe_image_final_cleanup(text, uuid, boolean, text) from anon';
        execute 'revoke all on function public.enqueue_deleted_recipe_image_finalization() from anon';
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
        execute 'revoke all on function public.enqueue_recipe_image_final_cleanup(text, uuid, uuid) from authenticated';
        execute 'revoke all on function public.abandon_recipe_image_finalization_attempt(uuid, text) from authenticated';
        execute 'revoke all on function public.claim_recipe_image_finalization(uuid, uuid, uuid, uuid) from authenticated';
        execute 'revoke all on function public.start_recipe_image_final_copy(uuid, uuid) from authenticated';
        execute 'revoke all on function public.finish_recipe_image_final_copy(uuid, uuid, text, integer) from authenticated';
        execute 'revoke all on function public.finish_recipe_image_finalization(uuid, uuid, uuid, uuid, text, integer) from authenticated';
        execute 'revoke all on function public.release_recipe_image_finalization(uuid, uuid, text) from authenticated';
        execute 'revoke all on function public.delete_recipe_image_association(uuid, uuid) from authenticated';
        execute 'revoke all on function public.resolve_recipe_image_download(uuid, uuid) from authenticated';
        execute 'revoke all on function public.claim_recipe_image_final_cleanup(integer) from authenticated';
        execute 'revoke all on function public.finish_recipe_image_final_cleanup(text, uuid, boolean, text) from authenticated';
        execute 'revoke all on function public.enqueue_deleted_recipe_image_finalization() from authenticated';
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
        execute 'grant execute on function public.claim_recipe_image_finalization(uuid, uuid, uuid, uuid) to service_role';
        execute 'grant execute on function public.start_recipe_image_final_copy(uuid, uuid) to service_role';
        execute 'grant execute on function public.finish_recipe_image_final_copy(uuid, uuid, text, integer) to service_role';
        execute 'grant execute on function public.finish_recipe_image_finalization(uuid, uuid, uuid, uuid, text, integer) to service_role';
        execute 'grant execute on function public.release_recipe_image_finalization(uuid, uuid, text) to service_role';
        execute 'grant execute on function public.delete_recipe_image_association(uuid, uuid) to service_role';
        execute 'grant execute on function public.resolve_recipe_image_download(uuid, uuid) to service_role';
        execute 'grant execute on function public.claim_recipe_image_final_cleanup(integer) to service_role';
        execute 'grant execute on function public.finish_recipe_image_final_cleanup(text, uuid, boolean, text) to service_role';
    end if;
end;
$$;
