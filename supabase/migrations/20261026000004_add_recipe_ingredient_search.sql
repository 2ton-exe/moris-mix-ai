alter table public.recipes add column if not exists ingredients_text text generated always as (ingredients::text) stored;

create index if not exists idx_recipes_user_ingredients_text
    on public.recipes(user_id, ingredients_text);
