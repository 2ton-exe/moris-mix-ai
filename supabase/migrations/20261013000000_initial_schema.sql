create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text,
    avatar_url text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.recipes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    title text not null,
    raw_input text,
    ingredients jsonb not null default '[]'::jsonb,
    instructions jsonb not null default '[]'::jsonb,
    flavor_scores jsonb not null default '{}'::jsonb,
    star_rating smallint check (star_rating >= 1 and star_rating <= 5),
    cooked_at date,
    image_url text,
    image_path text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.recipe_lineage (
    id uuid primary key default gen_random_uuid(),
    parent_recipe_id uuid not null references public.recipes(id) on delete cascade,
    child_recipe_id uuid not null references public.recipes(id) on delete cascade,
    created_at timestamptz not null default now(),
    constraint check_parent_child_distinct check (parent_recipe_id <> child_recipe_id),
    constraint unique_parent_child_pair unique (parent_recipe_id, child_recipe_id)
);

create table if not exists public.ai_usage_daily (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    usage_date date not null default current_date,
    operation_count integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint unique_user_daily_usage unique (user_id, usage_date)
);

create index if not exists idx_recipes_user_created 
    on public.recipes(user_id, created_at desc);

create index if not exists idx_recipes_user_rating 
    on public.recipes(user_id, star_rating desc);

create index if not exists idx_lineage_parent 
    on public.recipe_lineage(parent_recipe_id);

create index if not exists idx_lineage_child 
    on public.recipe_lineage(child_recipe_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists tr_profiles_updated_at on public.profiles;
create trigger tr_profiles_updated_at
    before update on public.profiles
    for each row
    execute function public.set_updated_at();

drop trigger if exists tr_recipes_updated_at on public.recipes;
create trigger tr_recipes_updated_at
    before update on public.recipes
    for each row
    execute function public.set_updated_at();

drop trigger if exists tr_ai_usage_daily_updated_at on public.ai_usage_daily;
create trigger tr_ai_usage_daily_updated_at
    before update on public.ai_usage_daily
    for each row
    execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
    insert into public.profiles (id, display_name, avatar_url)
    values (
        new.id,
        coalesce(new.raw_user_meta_data->>'full_name', new.email),
        new.raw_user_meta_data->>'avatar_url'
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row
    execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_lineage enable row level security;
alter table public.ai_usage_daily enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
    for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
    for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "recipes_select_own" on public.recipes;
create policy "recipes_select_own" on public.recipes
    for select using (auth.uid() = user_id);

drop policy if exists "recipes_insert_own" on public.recipes;
create policy "recipes_insert_own" on public.recipes
    for insert with check (auth.uid() = user_id);

drop policy if exists "recipes_update_own" on public.recipes;
create policy "recipes_update_own" on public.recipes
    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "recipes_delete_own" on public.recipes;
create policy "recipes_delete_own" on public.recipes
    for delete using (auth.uid() = user_id);

drop policy if exists "lineage_select_own" on public.recipe_lineage;
create policy "lineage_select_own" on public.recipe_lineage
    for select using (
        exists (
            select 1 from public.recipes
            where id = public.recipe_lineage.parent_recipe_id
              and user_id = auth.uid()
        )
    );

drop policy if exists "lineage_insert_own" on public.recipe_lineage;
create policy "lineage_insert_own" on public.recipe_lineage
    for insert with check (
        exists (
            select 1 from public.recipes
            where id = public.recipe_lineage.parent_recipe_id
              and user_id = auth.uid()
        ) and exists (
            select 1 from public.recipes
            where id = public.recipe_lineage.child_recipe_id
              and user_id = auth.uid()
        )
    );

drop policy if exists "lineage_delete_own" on public.recipe_lineage;
create policy "lineage_delete_own" on public.recipe_lineage
    for delete using (
        exists (
            select 1 from public.recipes
            where id = public.recipe_lineage.parent_recipe_id
              and user_id = auth.uid()
        )
    );

drop policy if exists "ai_usage_insert_own" on public.ai_usage_daily;
drop policy if exists "ai_usage_update_own" on public.ai_usage_daily;
drop policy if exists "ai_usage_select_own" on public.ai_usage_daily;
create policy "ai_usage_select_own" on public.ai_usage_daily
    for select using (auth.uid() = user_id);

grant usage on schema public to authenticated;

grant select, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.recipes to authenticated;
grant select, insert, delete on table public.recipe_lineage to authenticated;
grant select on table public.ai_usage_daily to authenticated;