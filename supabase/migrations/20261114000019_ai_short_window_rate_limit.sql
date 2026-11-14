alter table public.ai_usage_daily
    add column if not exists ai_rate_window_started_at timestamptz,
    add column if not exists ai_rate_window_count integer not null default 0;

alter table public.ai_usage_daily
    drop constraint if exists ai_usage_daily_rate_window_count_nonnegative;

alter table public.ai_usage_daily
    add constraint ai_usage_daily_rate_window_count_nonnegative
    check (ai_rate_window_count >= 0);

create or replace function public.consume_ai_quota(
    p_user_id uuid,
    p_reservation_id uuid,
    p_daily_limit integer default 20,
    p_usage_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_limit integer;
    v_usage_date date;
    v_daily_id uuid;
    v_current_count integer;
    v_rate_window_started_at timestamptz;
    v_rate_window_count integer;
    v_retry_after integer;
    v_existing_user_id uuid;
    v_existing_status text;
    v_existing_date date;
begin
    if auth.role() IS DISTINCT FROM 'service_role' then
        raise exception 'Unauthorized quota operation' using errcode = '42501';
    end if;

    perform pg_advisory_xact_lock(hashtext('ai-rate:' || p_user_id::text));
    perform pg_advisory_xact_lock(hashtext('reservation:' || p_reservation_id::text));

    v_limit := coalesce(p_daily_limit, 20);
    if v_limit < 1 then
        v_limit := 20;
    end if;

    v_usage_date := coalesce(p_usage_date, (now() at time zone 'utc')::date);

    select r.user_id, r.status, d.usage_date
    into v_existing_user_id, v_existing_status, v_existing_date
    from public.ai_quota_reservations r
    join public.ai_usage_daily d on d.id = r.daily_usage_id
    where r.id = p_reservation_id
    for update;

    if v_existing_status is not null then
        if v_existing_user_id <> p_user_id then
            raise exception 'Reservation user mismatch' using errcode = '42501';
        end if;

        if v_existing_date <> v_usage_date then
            raise exception 'Reservation date mismatch' using errcode = '22000';
        end if;

        return jsonb_build_object(
            'status', 'conflict',
            'is_new', false,
            'message', 'Reservation ID already consumed'
        );
    end if;

    loop
        insert into public.ai_usage_daily (
            user_id,
            usage_date,
            operation_count,
            ai_rate_window_started_at,
            ai_rate_window_count
        )
        values (
            p_user_id,
            v_usage_date,
            0,
            (select d.ai_rate_window_started_at from public.ai_usage_daily d where d.user_id = p_user_id order by d.usage_date desc limit 1),
            coalesce((select d.ai_rate_window_count from public.ai_usage_daily d where d.user_id = p_user_id order by d.usage_date desc limit 1), 0)
        )
        on conflict (user_id, usage_date) do nothing;

        select id, operation_count, ai_rate_window_started_at, ai_rate_window_count
        into v_daily_id, v_current_count, v_rate_window_started_at, v_rate_window_count
        from public.ai_usage_daily
        where user_id = p_user_id and usage_date = v_usage_date
        for update;

        exit when found;
    end loop;

    if v_current_count >= v_limit then
        return jsonb_build_object(
            'status', 'exceeded',
            'is_new', false,
            'limit', v_limit,
            'used', v_current_count
        );
    end if;

    if v_rate_window_started_at is null or v_rate_window_started_at <= now() - interval '60 seconds' then
        v_rate_window_started_at := now();
        v_rate_window_count := 0;
        update public.ai_usage_daily
        set ai_rate_window_started_at = v_rate_window_started_at,
            ai_rate_window_count = 0
        where id = v_daily_id;
    end if;

    if v_rate_window_count >= 5 then
        v_retry_after := least(
            60,
            greatest(1, ceil(extract(epoch from (v_rate_window_started_at + interval '60 seconds') - now()))::integer)
        );
        return jsonb_build_object(
            'status', 'rate_limited',
            'is_new', false,
            'limit', 5,
            'used', v_rate_window_count,
            'retry_after_seconds', v_retry_after
        );
    end if;

    insert into public.ai_quota_reservations (id, daily_usage_id, user_id, status)
    values (p_reservation_id, v_daily_id, p_user_id, 'reserved');

    update public.ai_usage_daily
    set operation_count = operation_count + 1,
        ai_rate_window_started_at = v_rate_window_started_at,
        ai_rate_window_count = v_rate_window_count + 1,
        updated_at = now()
    where id = v_daily_id;

    return jsonb_build_object(
        'status', 'allowed',
        'is_new', true,
        'limit', v_limit,
        'used', v_current_count + 1
    );
end;
$$;
