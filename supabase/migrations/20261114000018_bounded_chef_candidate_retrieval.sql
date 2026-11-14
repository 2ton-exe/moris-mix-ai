create or replace function public.get_chef_recipe_context_candidates(
    p_max_candidates integer,
    p_max_bytes integer
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
    v_user_id uuid := auth.uid();
    v_candidate_count integer;
    v_candidate_bytes bigint := 0;
    v_truncated boolean := false;
    v_last_created_at timestamptz;
    v_last_id uuid;
    v_candidate record;
    v_candidates jsonb;
begin
    if v_user_id is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    if p_max_candidates is null or p_max_candidates < 1 or p_max_candidates > 1000 then
        raise exception 'p_max_candidates must be between 1 and 1000' using errcode = '22023';
    end if;
    if p_max_bytes is null or p_max_bytes < 1 or p_max_bytes > 65536 then
        raise exception 'p_max_bytes must be between 1 and 65536' using errcode = '22023';
    end if;

    select count(*)::integer
    into v_candidate_count
    from (
        select r.id
        from public.recipes r
        where r.user_id = v_user_id
        order by r.created_at desc, r.id asc
        limit p_max_candidates
    ) candidates;

    if v_candidate_count = p_max_candidates then
        select r.created_at, r.id
        into v_last_created_at, v_last_id
        from public.recipes r
        where r.user_id = v_user_id
        order by r.created_at desc, r.id asc
        offset p_max_candidates - 1
        limit 1;

        select exists (
            select 1
            from public.recipes r
            where r.user_id = v_user_id
              and (
                  r.created_at < v_last_created_at
                  or (r.created_at = v_last_created_at and r.id > v_last_id)
              )
        )
        into v_truncated;
    end if;

    for v_candidate in
        select
            r.id,
            r.user_id,
            r.title,
            r.ingredients,
            r.instructions,
            r.flavor_scores,
            r.star_rating,
            r.created_at
        from public.recipes r
        where r.user_id = v_user_id
        order by r.created_at desc, r.id asc
        limit p_max_candidates
    loop
        v_candidate_bytes := v_candidate_bytes +
            octet_length(to_jsonb(v_candidate)::text) + 2;
        if v_candidate_bytes + 256 > p_max_bytes then
            exit;
        end if;
    end loop;

    if v_candidate_count > 0 and v_candidate_bytes + 256 > p_max_bytes then
        return jsonb_build_object(
            'candidates', '[]'::jsonb,
            'candidate_count', v_candidate_count,
            'truncated', v_truncated,
            'too_large', true
        );
    end if;

    with candidates as materialized (
        select
            r.id,
            r.user_id,
            r.title,
            r.ingredients,
            r.instructions,
            r.flavor_scores,
            r.star_rating,
            r.created_at
        from public.recipes r
        where r.user_id = v_user_id
        order by r.created_at desc, r.id asc
        limit p_max_candidates
    )
    select coalesce(
        jsonb_agg(to_jsonb(c) order by c.created_at desc, c.id asc),
        '[]'::jsonb
    )
    into v_candidates
    from candidates c;

    return jsonb_build_object(
        'candidates', v_candidates,
        'candidate_count', v_candidate_count,
        'truncated', v_truncated,
        'too_large', false
    );
end;
$$;

revoke all on function public.get_chef_recipe_context_candidates(integer, integer) from public, anon;
grant execute on function public.get_chef_recipe_context_candidates(integer, integer) to authenticated;
