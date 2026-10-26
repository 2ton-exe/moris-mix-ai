create index if not exists idx_recipes_user_created_id
    on public.recipes(user_id, created_at desc, id asc);

create index if not exists idx_recipes_user_rating_created_id
    on public.recipes(user_id, star_rating desc nulls last, created_at desc, id asc);
