-- Score bounded pages before loading the highest-ranked recipe bodies.
create function public.get_chef_recipe_context_candidate_page(
    p_max_candidates integer,
    p_max_bytes integer,
    p_after_created_at timestamptz,
    p_after_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
    v_user_id uuid := auth.uid();
    v_candidate record;
    v_summary jsonb;
    v_candidates jsonb := '[]'::jsonb;
    v_bytes bigint := 256;
    v_count integer := 0;
    v_skipped integer := 0;
    v_truncated boolean := false;
    v_cursor jsonb := null;
begin
    if v_user_id is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    if p_max_candidates is null or p_max_candidates < 1 or p_max_candidates > 1000 then
        raise exception 'p_max_candidates must be between 1 and 1000' using errcode = '22023';
    end if;
    if p_max_bytes is null or p_max_bytes < 256 or p_max_bytes > 131072 then
        raise exception 'p_max_bytes must be between 256 and 131072' using errcode = '22023';
    end if;
    if (p_after_created_at is null) <> (p_after_id is null) then
        raise exception 'Both cursor fields are required' using errcode = '22023';
    end if;

    for v_candidate in
        select r.id, r.user_id, r.title, r.ingredients, r.instructions,
            r.flavor_scores, r.star_rating, r.created_at
        from public.recipes r
        where r.user_id = v_user_id
          and (p_after_id is null or r.created_at < p_after_created_at
            or (r.created_at = p_after_created_at and r.id > p_after_id))
        order by r.created_at desc, r.id asc
        limit p_max_candidates + 1
    loop
        if v_count = p_max_candidates then
            v_truncated := true;
            exit;
        end if;
        v_summary := jsonb_build_object(
            'id', v_candidate.id, 'user_id', v_candidate.user_id,
            'title', v_candidate.title,
            'ingredients', coalesce((select jsonb_agg(jsonb_build_object('name', ingredient->>'name'))
                from jsonb_array_elements(v_candidate.ingredients) ingredient), '[]'::jsonb),
            'instructions', '[]'::jsonb, 'flavor_scores', null,
            'star_rating', v_candidate.star_rating, 'created_at', v_candidate.created_at,
            'context_bytes', octet_length(to_jsonb(v_candidate)::text)
        );
        if octet_length(v_summary::text) + 258 > p_max_bytes then
            -- Legacy records exceeding today's write limits must not block later pages.
            v_skipped := v_skipped + 1;
        elsif v_bytes + octet_length(v_summary::text) + 2 > p_max_bytes then
            v_truncated := true;
            exit;
        else
            v_candidates := v_candidates || jsonb_build_array(v_summary);
            v_bytes := v_bytes + octet_length(v_summary::text) + 2;
        end if;
        v_count := v_count + 1;
        v_cursor := jsonb_build_object('id', v_candidate.id, 'created_at', v_candidate.created_at);
    end loop;

    return jsonb_build_object(
        'candidates', v_candidates, 'candidate_count', v_count,
        'skipped_count', v_skipped, 'truncated', v_truncated,
        'next_cursor', case when v_truncated then v_cursor else null end
    );
end;
$$;

revoke all on function public.get_chef_recipe_context_candidate_page(integer, integer, timestamptz, uuid) from public, anon;
grant execute on function public.get_chef_recipe_context_candidate_page(integer, integer, timestamptz, uuid) to authenticated;

-- Keep the deployed two-integer overload until the separate Edge release completes.
-- The new handler requests only IDs selected by its existing ranking rules.
create function public.get_chef_recipe_context_candidates(p_recipe_ids uuid[], p_max_bytes integer)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
    v_user_id uuid := auth.uid();
    v_candidate record;
    v_candidates jsonb := '[]'::jsonb;
    v_bytes bigint := 256;
begin
    if v_user_id is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    if p_recipe_ids is null or cardinality(p_recipe_ids) < 1 or cardinality(p_recipe_ids) > 10 then
        raise exception 'Select between 1 and 10 candidates' using errcode = '22023';
    end if;
    if p_max_bytes is null or p_max_bytes < 256 or p_max_bytes > 65536 then
        raise exception 'p_max_bytes must be between 256 and 65536' using errcode = '22023';
    end if;
    for v_candidate in
        select r.id, r.user_id, r.title, r.ingredients, r.instructions,
            r.flavor_scores, r.star_rating, r.created_at
        from public.recipes r
        where r.user_id = v_user_id and r.id = any(p_recipe_ids)
        order by array_position(p_recipe_ids, r.id)
    loop
        v_bytes := v_bytes + octet_length(to_jsonb(v_candidate)::text) + 2;
        if v_bytes > p_max_bytes then
            return jsonb_build_object('candidates', '[]'::jsonb, 'too_large', true);
        end if;
        v_candidates := v_candidates || jsonb_build_array(to_jsonb(v_candidate));
    end loop;
    return jsonb_build_object('candidates', v_candidates, 'too_large', false);
end;
$$;

revoke all on function public.get_chef_recipe_context_candidates(uuid[], integer) from public, anon;
grant execute on function public.get_chef_recipe_context_candidates(uuid[], integer) to authenticated;
