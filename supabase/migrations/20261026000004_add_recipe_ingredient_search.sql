alter table public.recipes add column if not exists ingredients_text text
    generated always as (coalesce(jsonb_path_query_array(ingredients, '$[*].name')::text, '[]')) stored;
