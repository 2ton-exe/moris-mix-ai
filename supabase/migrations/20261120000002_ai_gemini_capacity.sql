create table public.ai_gemini_minute_attempts (
    project text not null,
    model text not null,
    attempted_at timestamptz not null
);

create index ai_gemini_minute_attempts_window_idx
    on public.ai_gemini_minute_attempts (project, model, attempted_at desc);

create table public.ai_gemini_daily_attempts (
    project text not null,
    model text not null,
    usage_date date not null,
    attempt_count bigint not null check (attempt_count > 0),
    primary key (project, model, usage_date)
);

alter table public.ai_gemini_minute_attempts enable row level security;
alter table public.ai_gemini_daily_attempts enable row level security;
revoke all on public.ai_gemini_minute_attempts, public.ai_gemini_daily_attempts
    from public;

create function public.admit_ai_gemini_attempt(
    p_project text,
    p_model text,
    p_rpm_limit integer,
    p_rpd_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_now timestamptz;
    v_usage_date date;
    v_window_start timestamptz;
    v_next_minute_slot timestamptz;
    v_next_daily_slot timestamptz;
    v_daily_count bigint;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Unauthorized quota operation' using errcode = '42501';
    end if;

    if nullif(btrim(p_project), '') is null
        or nullif(btrim(p_model), '') is null
        or (p_rpm_limit is null and p_rpd_limit is null)
        or p_rpm_limit < 1 or p_rpd_limit < 1 then
        raise exception 'Invalid Gemini quota configuration' using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(
        hashtextextended(jsonb_build_array('ai-gemini', p_project, p_model)::text, 0)
    );
    v_now := clock_timestamp();
    v_usage_date := (v_now at time zone 'America/Los_Angeles')::date;
    v_window_start := v_now - interval '60 seconds';

    delete from public.ai_gemini_minute_attempts
    where project = p_project and model = p_model and attempted_at <= v_window_start;

    delete from public.ai_gemini_daily_attempts
    where project = p_project and model = p_model and usage_date < v_usage_date;

    if p_rpm_limit is not null then
        select attempted_at + interval '60 seconds'
        into v_next_minute_slot
        from public.ai_gemini_minute_attempts
        where project = p_project and model = p_model
        order by attempted_at desc
        offset (p_rpm_limit - 1) limit 1;
    end if;

    if p_rpd_limit is not null then
        select attempt_count into v_daily_count
        from public.ai_gemini_daily_attempts
        where project = p_project and model = p_model and usage_date = v_usage_date;

        if v_daily_count >= p_rpd_limit then
            v_next_daily_slot :=
                (v_usage_date + 1)::timestamp at time zone 'America/Los_Angeles';
        end if;
    end if;

    if v_next_minute_slot is not null or v_next_daily_slot is not null then
        return jsonb_build_object(
            'status', 'exceeded',
            'retry_after_seconds',
            greatest(1, ceil(extract(epoch from (
                greatest(v_next_minute_slot, v_next_daily_slot) - v_now
            )))::integer)
        );
    end if;

    insert into public.ai_gemini_minute_attempts (project, model, attempted_at)
    values (p_project, p_model, v_now);

    insert into public.ai_gemini_daily_attempts (project, model, usage_date, attempt_count)
    values (p_project, p_model, v_usage_date, 1)
    on conflict (project, model, usage_date) do update
    set attempt_count = ai_gemini_daily_attempts.attempt_count + 1;

    return jsonb_build_object('status', 'allowed');
end;
$$;

revoke all on function public.admit_ai_gemini_attempt(text, text, integer, integer)
    from public;
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on public.ai_gemini_minute_attempts, public.ai_gemini_daily_attempts from anon;
        revoke execute on function public.admit_ai_gemini_attempt(text, text, integer, integer) from anon;
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
        revoke all on public.ai_gemini_minute_attempts, public.ai_gemini_daily_attempts from authenticated;
        revoke execute on function public.admit_ai_gemini_attempt(text, text, integer, integer) from authenticated;
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
        grant execute on function public.admit_ai_gemini_attempt(text, text, integer, integer) to service_role;
    end if;
end;
$$;
