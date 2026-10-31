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
        exit;
      end if;
    end loop;
    if not word_matched then
      return null;
    end if;
  end loop;

  return 3;
end;
$$;
