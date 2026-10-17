insert into auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
) values (
    'd0d8c0b2-3b1e-4c7b-9e2a-1a2b3c4d5e6f',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'demo@morisscraps.local',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Demo Chef"}',
    now(),
    now()
) on conflict (id) do nothing;

insert into public.recipes (
    id,
    user_id,
    title,
    raw_input,
    ingredients,
    instructions,
    flavor_scores,
    star_rating,
    cooked_at,
    is_public
) values (
    '11111111-1111-1111-1111-111111111111',
    'd0d8c0b2-3b1e-4c7b-9e2a-1a2b3c4d5e6f',
    'Classic Tomato Scraps Pasta',
    'Used leftover tomato paste, wilted basil, garlic, and spaghetti.',
    '[{"name": "spaghetti", "quantity": 200, "unit": "g", "inferred": false}, {"name": "tomato paste", "quantity": 2, "unit": "tbsp", "inferred": false}, {"name": "garlic", "quantity": 2, "unit": "cloves", "inferred": false}, {"name": "Fresh basil", "quantity": null, "unit": null, "inferred": false}]'::jsonb,
    '[{"step": 1, "text": "Boil pasta in salted water."}, {"step": 2, "text": "Saute minced garlic and tomato paste."}, {"step": 3, "text": "Toss pasta with sauce and torn basil."}]'::jsonb,
    '{"sweet": 2, "salty": 3, "sour": 3, "bitter": 1, "umami": 4, "spicy": 0}'::jsonb,
    4,
    current_date - interval '2 days',
    true
),
(
    '22222222-2222-2222-2222-222222222222',
    'd0d8c0b2-3b1e-4c7b-9e2a-1a2b3c4d5e6f',
    'Spicy Tomato Scraps Pasta (Iteration 1)',
    'Iterated on the classic pasta by adding chili flakes and parmesan rind.',
    '[{"name": "spaghetti", "quantity": 200, "unit": "g", "inferred": false}, {"name": "tomato paste", "quantity": 2, "unit": "tbsp", "inferred": false}, {"name": "garlic", "quantity": 2, "unit": "cloves", "inferred": false}, {"name": "chili flakes", "quantity": 1, "unit": "tsp", "inferred": false}, {"name": "Parmesan rind", "quantity": null, "unit": null, "inferred": false}]'::jsonb,
    '[{"step": 1, "text": "Simmer sauce with parmesan rind for depth."}, {"step": 2, "text": "Add chili flakes."}, {"step": 3, "text": "Combine with spaghetti."}]'::jsonb,
    '{"sweet": 2, "salty": 4, "sour": 3, "bitter": 1, "umami": 5, "spicy": 4}'::jsonb,
    5,
    current_date,
    false
) on conflict (id) do nothing;

insert into public.recipe_lineage (
    parent_recipe_id,
    child_recipe_id
) values (
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222'
) on conflict do nothing;

insert into public.ai_usage_daily (
    user_id,
    usage_date,
    operation_count
) values (
    'd0d8c0b2-3b1e-4c7b-9e2a-1a2b3c4d5e6f',
    current_date,
    1
) on conflict (user_id, usage_date) do nothing;