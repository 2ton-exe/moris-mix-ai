create or replace function public.consume_ai_quota(
    p_user_id uuid,
    p_reservation_id uuid,
    p_daily_limit integer,
    p_usage_date date,
    p_burst_limit integer
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
    v_admitted_at timestamptz;
    v_releases_at timestamptz;
    v_rolling_started_at timestamptz;
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

    v_admitted_at := clock_timestamp();
    v_usage_date := coalesce(p_usage_date, (v_admitted_at at time zone 'utc')::date);

    if p_burst_limit < 1 then
        raise exception 'Invalid account burst limit' using errcode = '22023';
    end if;

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

    if p_burst_limit is not null then
        -- Refunded reservations still occupy a burst slot until they age out.
        select created_at into v_rolling_started_at
        from public.ai_quota_reservations
        where user_id = p_user_id
          and created_at > v_admitted_at - interval '60 seconds'
        order by created_at desc
        offset p_burst_limit - 1
        limit 1;
        v_releases_at := v_rolling_started_at + interval '60 seconds';
    elsif v_rate_window_count >= 5
        and v_rate_window_started_at > v_admitted_at - interval '60 seconds' then
        v_releases_at := v_rate_window_started_at + interval '60 seconds';
    end if;

    if v_current_count >= v_limit then
        return jsonb_build_object(
            'status', 'exceeded',
            'is_new', false,
            'limit', v_limit,
            'used', v_current_count
        ) || case when v_releases_at is not null then
            jsonb_build_object(
                'retry_after_seconds',
                greatest(1, ceil(extract(epoch from greatest(
                    ((v_usage_date + 1)::timestamp at time zone 'utc'),
                    v_releases_at
                ) - v_admitted_at))::integer)
            )
        else '{}'::jsonb end;
    end if;

    if v_releases_at is not null then
        v_retry_after := greatest(1, ceil(extract(epoch from v_releases_at - v_admitted_at))::integer);
        return jsonb_build_object(
            'status', 'rate_limited',
            'is_new', false,
            'limit', coalesce(p_burst_limit, 5),
            'used', case when p_burst_limit is null then v_rate_window_count else p_burst_limit end,
            'retry_after_seconds', v_retry_after
        );
    end if;

    insert into public.ai_quota_reservations (id, daily_usage_id, user_id, status, created_at)
    values (p_reservation_id, v_daily_id, p_user_id, 'reserved', v_admitted_at);

    -- Maintain the legacy window so rolling enforcement can be disabled safely.
    if v_rate_window_started_at is null or v_rate_window_started_at <= v_admitted_at - interval '60 seconds' then
        v_rate_window_started_at := v_admitted_at;
        v_rate_window_count := 0;
    end if;

    update public.ai_usage_daily
    set operation_count = operation_count + 1,
        ai_rate_window_started_at = v_rate_window_started_at,
        ai_rate_window_count = v_rate_window_count + 1,
        updated_at = v_admitted_at
    where id = v_daily_id;

    return jsonb_build_object(
        'status', 'allowed',
        'is_new', true,
        'limit', v_limit,
        'used', v_current_count + 1
    );
end;
$$;

revoke execute on function public.consume_ai_quota(uuid, uuid, integer, date, integer)
    from public, anon, authenticated;
grant execute on function public.consume_ai_quota(uuid, uuid, integer, date, integer)
    to service_role;

create or replace function public.consume_ai_quota(
    p_user_id uuid,
    p_reservation_id uuid,
    p_daily_limit integer default 20,
    p_usage_date date default null
)
returns jsonb
language sql
security definer
set search_path = public, extensions, pg_temp
as $$
    select public.consume_ai_quota(p_user_id, p_reservation_id, p_daily_limit, p_usage_date, null);
$$;
