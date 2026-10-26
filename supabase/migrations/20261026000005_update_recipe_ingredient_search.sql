drop index if exists public.idx_recipes_user_ingredients_text;

alter table public.recipes drop column if exists ingredients_text;

alter table public.recipes add column ingredients_text text
    generated always as (coalesce(jsonb_path_query_array(ingredients, '$[*].name')::text, '[]')) stored;
