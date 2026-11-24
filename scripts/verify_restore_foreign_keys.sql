-- Bounded to Backup #4's seven application foreign keys at its recorded source
-- revision. Return only a fixed scalar so callers can suppress all SQL details.
WITH expected_fks (
    child_schema, child_table, child_column,
    parent_schema, parent_table, parent_column
) AS (
    VALUES
        ('public', 'profiles', 'id', 'auth', 'users', 'id'),
        ('public', 'recipes', 'user_id', 'auth', 'users', 'id'),
        ('public', 'recipe_lineage', 'parent_recipe_id', 'public', 'recipes', 'id'),
        ('public', 'recipe_lineage', 'child_recipe_id', 'public', 'recipes', 'id'),
        ('public', 'ai_usage_daily', 'user_id', 'auth', 'users', 'id'),
        ('public', 'ai_quota_reservations', 'daily_usage_id', 'public', 'ai_usage_daily', 'id'),
        ('public', 'ai_quota_reservations', 'user_id', 'auth', 'users', 'id')
),
missing_or_ambiguous_fks AS (
    SELECT e.*
    FROM expected_fks AS e
    WHERE (
        SELECT count(*)
        FROM pg_catalog.pg_constraint AS c
        JOIN pg_catalog.pg_class AS child
          ON child.oid = c.conrelid
        JOIN pg_catalog.pg_namespace AS child_ns
          ON child_ns.oid = child.relnamespace
        JOIN pg_catalog.pg_attribute AS child_attr
          ON child_attr.attrelid = child.oid
         AND child_attr.attname = e.child_column
         AND child_attr.attnum > 0
         AND NOT child_attr.attisdropped
        JOIN pg_catalog.pg_class AS parent
          ON parent.oid = c.confrelid
        JOIN pg_catalog.pg_namespace AS parent_ns
          ON parent_ns.oid = parent.relnamespace
        JOIN pg_catalog.pg_attribute AS parent_attr
          ON parent_attr.attrelid = parent.oid
         AND parent_attr.attname = e.parent_column
         AND parent_attr.attnum > 0
         AND NOT parent_attr.attisdropped
        WHERE c.contype = 'f'
          AND c.convalidated
          AND child_ns.nspname = e.child_schema
          AND child.relname = e.child_table
          AND parent_ns.nspname = e.parent_schema
          AND parent.relname = e.parent_table
          AND c.conkey = ARRAY[child_attr.attnum]::smallint[]
          AND c.confkey = ARRAY[parent_attr.attnum]::smallint[]
    ) <> 1
),
application_fk_count AS (
    SELECT count(*) AS count
    FROM pg_catalog.pg_constraint AS c
    JOIN pg_catalog.pg_class AS child
      ON child.oid = c.conrelid
    JOIN pg_catalog.pg_namespace AS child_ns
      ON child_ns.oid = child.relnamespace
    WHERE c.contype = 'f'
      AND child_ns.nspname = 'public'
      AND child.relname IN (
          'profiles', 'recipes', 'recipe_lineage',
          'ai_usage_daily', 'ai_quota_reservations'
      )
),
orphaned_rows AS (
    SELECT 1
    FROM public.profiles AS child
    LEFT JOIN auth.users AS parent ON parent.id = child.id
    WHERE child.id IS NOT NULL AND parent.id IS NULL
    UNION ALL
    SELECT 1
    FROM public.recipes AS child
    LEFT JOIN auth.users AS parent ON parent.id = child.user_id
    WHERE child.user_id IS NOT NULL AND parent.id IS NULL
    UNION ALL
    SELECT 1
    FROM public.recipe_lineage AS child
    LEFT JOIN public.recipes AS parent ON parent.id = child.parent_recipe_id
    WHERE child.parent_recipe_id IS NOT NULL AND parent.id IS NULL
    UNION ALL
    SELECT 1
    FROM public.recipe_lineage AS child
    LEFT JOIN public.recipes AS parent ON parent.id = child.child_recipe_id
    WHERE child.child_recipe_id IS NOT NULL AND parent.id IS NULL
    UNION ALL
    SELECT 1
    FROM public.ai_usage_daily AS child
    LEFT JOIN auth.users AS parent ON parent.id = child.user_id
    WHERE child.user_id IS NOT NULL AND parent.id IS NULL
    UNION ALL
    SELECT 1
    FROM public.ai_quota_reservations AS child
    LEFT JOIN public.ai_usage_daily AS parent ON parent.id = child.daily_usage_id
    WHERE child.daily_usage_id IS NOT NULL AND parent.id IS NULL
    UNION ALL
    SELECT 1
    FROM public.ai_quota_reservations AS child
    LEFT JOIN auth.users AS parent ON parent.id = child.user_id
    WHERE child.user_id IS NOT NULL AND parent.id IS NULL
)
SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM missing_or_ambiguous_fks)
     AND (SELECT count FROM application_fk_count) = 7
     AND NOT EXISTS (SELECT 1 FROM orphaned_rows)
    THEN 1
    ELSE 0
END;
