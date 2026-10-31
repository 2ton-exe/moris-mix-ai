create or replace function public.damerau_levenshtein(s1 text, s2 text)
returns int
language plpgsql
immutable
as $$
declare
  len1 int := length(s1);
  len2 int := length(s2);
  d int[];
  i int;
  j int;
  cost int;
begin
  if len1 = 0 then return len2; end if;
  if len2 = 0 then return len1; end if;
  if abs(len1 - len2) > 3 then return abs(len1 - len2); end if;

  d := array_fill(0, array[(len1 + 1) * (len2 + 1)]);

  for i in 0..len1 loop
    d[i * (len2 + 1) + 1] := i;
  end loop;
  for j in 0..len2 loop
    d[j + 1] := j;
  end loop;

  for i in 1..len1 loop
    for j in 1..len2 loop
      if substring(s1 from i for 1) = substring(s2 from j for 1) then
        cost := 0;
      else
        cost := 1;
      end if;

      d[i * (len2 + 1) + j + 1] := least(
        d[(i - 1) * (len2 + 1) + j + 1] + 1,
        d[i * (len2 + 1) + (j - 1) + 1] + 1,
        d[(i - 1) * (len2 + 1) + (j - 1) + 1] + cost
      );

      if i > 1 and j > 1 and substring(s1 from i for 1) = substring(s2 from j - 1 for 1) and substring(s1 from i - 1 for 1) = substring(s2 from j for 1) then
        d[i * (len2 + 1) + j + 1] := least(
          d[i * (len2 + 1) + j + 1],
          d[(i - 2) * (len2 + 1) + (j - 2) + 1] + 1
        );
      end if;
    end loop;
  end loop;

  return d[len1 * (len2 + 1) + len2 + 1];
end;
$$;

create or replace function public.match_text_rank(target text, query text)
returns int
language plpgsql
immutable
as $$
declare
  t_norm text := lower(trim(target));
  q_norm text := lower(trim(query));
  q_words text[];
  t_words text[];
  qw text;
  tw text;
  word_matched boolean;
  has_fuzzy boolean := false;
  q_len int;
begin
  if t_norm = '' or q_norm = '' then return null; end if;
  if t_norm = q_norm then return 1; end if;
  if position(q_norm in t_norm) > 0 then return 2; end if;

  q_words := regexp_split_to_array(q_norm, '\s+');
  t_words := regexp_split_to_array(t_norm, '\s+');

  foreach qw in array q_words loop
    word_matched := false;
    q_len := length(qw);
    foreach tw in array t_words loop
      if tw = qw or position(qw in tw) > 0 then
        word_matched := true;
        exit;
      elsif q_len >= 4 and public.damerau_levenshtein(qw, tw) <= (case when q_len >= 7 then 2 else 1 end) then
        word_matched := true;
        has_fuzzy := true;
        exit;
      end if;
    end loop;
    if not word_matched then
      return null;
    end if;
  end loop;

  if has_fuzzy then return 3; else return 2; end if;
end;
$$;

create or replace function public.match_ingredients_rank(ingredients jsonb, query text)
returns int
language plpgsql
immutable
as $$
declare
  q_norm text := lower(trim(query));
  ing jsonb;
  name_text text;
  best_rank int := null;
  cur_rank int;
begin
  if q_norm = '' or jsonb_typeof(ingredients) <> 'array' then return null; end if;

  for ing in select * from jsonb_array_elements(ingredients) loop
    if jsonb_typeof(ing) = 'object' then
      name_text := lower(trim(coalesce(ing->>'name', '')));
    elsif jsonb_typeof(ing) = 'string' then
      name_text := lower(trim(ing #>> '{}'));
    else
      name_text := '';
    end if;
    if name_text <> '' then
      cur_rank := public.match_text_rank(name_text, q_norm);
      if cur_rank is not null then
        if best_rank is null or cur_rank < best_rank then
          best_rank := cur_rank;
          if best_rank = 1 then return 1; end if;
        end if;
      end if;
    end if;
  end loop;

  return best_rank;
end;
$$;

create or replace function public.search_recipes(
  p_search text default null,
  p_title text default null,
  p_ingredient text default null,
  p_sort text default 'newest',
  p_limit int default 20,
  p_offset int default 0,
  p_cursor_rank int default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_star_rating smallint default null,
  p_cursor_id uuid default null
)
returns table (
  id uuid,
  user_id uuid,
  title text,
  raw_input text,
  notes text,
  ingredients jsonb,
  instructions jsonb,
  flavor_scores jsonb,
  star_rating smallint,
  cooked_at date,
  image_url text,
  image_path text,
  is_public boolean,
  created_at timestamptz,
  updated_at timestamptz,
  relevance_rank int
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_search text := lower(trim(coalesce(p_search, '')));
  v_title text := lower(trim(coalesce(p_title, '')));
  v_ingredient text := lower(trim(coalesce(p_ingredient, '')));
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;

  if v_search = '' and v_title <> '' and v_title = v_ingredient then
    v_search := v_title;
    v_title := '';
    v_ingredient := '';
  end if;

  return query
  select
    r.id,
    r.user_id,
    r.title,
    r.raw_input,
    r.notes,
    r.ingredients,
    r.instructions,
    r.flavor_scores,
    r.star_rating,
    r.cooked_at,
    r.image_url,
    r.image_path,
    r.is_public,
    r.created_at,
    r.updated_at,
    ranked.rank as relevance_rank
  from public.recipes r
  cross join lateral (
    select
      case
        when v_search <> '' then
          least(
            public.match_text_rank(r.title, v_search),
            public.match_ingredients_rank(r.ingredients, v_search)
          )
        when v_title <> '' and v_ingredient <> '' then
          case
            when public.match_text_rank(r.title, v_title) is not null
             and public.match_ingredients_rank(r.ingredients, v_ingredient) is not null then
              greatest(
                public.match_text_rank(r.title, v_title),
                public.match_ingredients_rank(r.ingredients, v_ingredient)
              )
            else null
          end
        when v_title <> '' then
          public.match_text_rank(r.title, v_title)
        when v_ingredient <> '' then
          public.match_ingredients_rank(r.ingredients, v_ingredient)
        else null
      end as rank
  ) ranked
  where r.user_id = v_uid
    and ranked.rank is not null
    and (
      p_cursor_rank is null
      or ranked.rank > p_cursor_rank
      or (ranked.rank = p_cursor_rank and (
        (p_sort = 'newest' and (r.created_at < p_cursor_created_at or (r.created_at = p_cursor_created_at and r.id > p_cursor_id)))
        or
        (p_sort = 'rating' and (
          (p_cursor_star_rating is not null and (
            r.star_rating < p_cursor_star_rating
            or r.star_rating is null
            or (r.star_rating = p_cursor_star_rating and (r.created_at < p_cursor_created_at or (r.created_at = p_cursor_created_at and r.id > p_cursor_id)))
          ))
          or
          (p_cursor_star_rating is null and (
            r.star_rating is null and (r.created_at < p_cursor_created_at or (r.created_at = p_cursor_created_at and r.id > p_cursor_id))
          ))
        ))
      ))
    )
  order by
    ranked.rank asc,
    case when p_sort = 'rating' then r.star_rating end desc nulls last,
    r.created_at desc,
    r.id asc
  limit p_limit + 1
  offset (case when p_cursor_rank is not null then 0 else p_offset end);
end;
$$;

revoke all on function public.damerau_levenshtein(text, text) from public;
grant execute on function public.damerau_levenshtein(text, text) to authenticated;

revoke all on function public.match_text_rank(text, text) from public;
grant execute on function public.match_text_rank(text, text) to authenticated;

revoke all on function public.match_ingredients_rank(jsonb, text) from public;
grant execute on function public.match_ingredients_rank(jsonb, text) to authenticated;

revoke all on function public.search_recipes(text, text, text, text, int, int, int, timestamptz, smallint, uuid) from public;
grant execute on function public.search_recipes(text, text, text, text, int, int, int, timestamptz, smallint, uuid) to authenticated;
