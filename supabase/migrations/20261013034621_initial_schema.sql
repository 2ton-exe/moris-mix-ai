create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text,
    avatar_url text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, display_name, avatar_url)
    values (
        new.id,
        coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
        coalesce(new.raw_user_meta_data->>'avatar_url', '')
    );
    return new;
end;
$$;

create or replace trigger on_auth_user_created
    after insert on auth.users
    for each row
    execute function public.handle_new_user();

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
    constraint check_lineage_no_self_reference check (parent_recipe_id <> child_recipe_id),
    constraint unique_recipe_lineage_pair unique (parent_recipe_id, child_recipe_id)
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

create index if not exists idx_recipes_user_created on public.recipes(user_id, created_at desc);
create index if not exists idx_recipes_user_rating on public.recipes(user_id, star_rating desc);
create index if not exists idx_lineage_parent on public.recipe_lineage(parent_recipe_id);
create index if not exists idx_lineage_child on public.recipe_lineage(child_recipe_id);

alter table public.profiles enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_lineage enable row level security;
alter table public.ai_usage_daily enable row level security;

create policy "Users can view own profile"
    on public.profiles
    for select
    using (auth.uid() = id);

create policy "Users can update own profile"
    on public.profiles
    for update
    using (auth.uid() = id);

create policy "Users can view own recipes"
    on public.recipes
    for select
    using (auth.uid() = user_id);

create policy "Users can create own recipes"
    on public.recipes
    for insert
    with check (auth.uid() = user_id);

create policy "Users can update own recipes"
    on public.recipes
    for update
    using (auth.uid() = user_id);

create policy "Users can delete own recipes"
    on public.recipes
    for delete
    using (auth.uid() = user_id);

create policy "Users can view own recipe lineage"
    on public.recipe_lineage
    for select
    using (
        exists (
            select 1 from public.recipes r1
            where r1.id = parent_recipe_id and r1.user_id = auth.uid()
        )
        and
        exists (
            select 1 from public.recipes r2
            where r2.id = child_recipe_id and r2.user_id = auth.uid()
        )
    );

create policy "Users can insert own recipe lineage"
    on public.recipe_lineage
    for insert
    with check (
        exists (
            select 1 from public.recipes r1
            where r1.id = parent_recipe_id and r1.user_id = auth.uid()
        )
        and
        exists (
            select 1 from public.recipes r2
            where r2.id = child_recipe_id and r2.user_id = auth.uid()
        )
    );

create policy "Users can delete own recipe lineage"
    on public.recipe_lineage
    for delete
    using (
        exists (
            select 1 from public.recipes r1
            where r1.id = parent_recipe_id and r1.user_id = auth.uid()
        )
        and
        exists (
            select 1 from public.recipes r2
            where r2.id = child_recipe_id and r2.user_id = auth.uid()
        )
    );

create policy "Users can view own ai usage"
    on public.ai_usage_daily
    for select
    using (auth.uid() = user_id);

create policy "Users can insert own ai usage"
    on public.ai_usage_daily
    for insert
    with check (auth.uid() = user_id);

create policy "Users can update own ai usage"
    on public.ai_usage_daily
    for update
    using (auth.uid() = user_id);