create table public.recipe_image_upload_intents (
    id uuid primary key,
    user_id uuid not null,
    recipe_id uuid not null,
    staging_key text not null unique,
    final_key text not null unique,
    content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
    byte_size integer not null check (byte_size between 1 and 10485760),
    created_at timestamptz not null,
    expires_at timestamptz not null,
    state text not null default 'pending' check (state = 'pending'),
    check (staging_key = 'recipe-images/staging/' || user_id::text || '/' || recipe_id::text || '/' || id::text),
    check (final_key ~ ('^recipe-images/final/' || user_id::text || '/' || recipe_id::text || '/' || id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')),
    check (expires_at = created_at + interval '10 minutes')
);

alter table public.recipe_image_upload_intents enable row level security;
alter table public.recipe_image_upload_intents force row level security;

revoke all on table public.recipe_image_upload_intents from public, anon, authenticated, service_role;
grant select, insert on table public.recipe_image_upload_intents to service_role;

create index recipe_image_upload_intents_expiry_idx
    on public.recipe_image_upload_intents (expires_at);
