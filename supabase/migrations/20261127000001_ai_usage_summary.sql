create function public.get_ai_usage_summary(
    p_user_id uuid,
    p_daily_limit integer,
    p_burst_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Unauthorized quota operation' using errcode = '42501';
    end if;
    if p_user_id is null or p_daily_limit is null or p_daily_limit < 1 or p_burst_limit < 1 then
        raise exception 'Invalid quota configuration' using errcode = '22023';
    end if;

    return (
        with instant as (
            select statement_timestamp() as observed_at
        ), latest as (
            select ai_rate_window_started_at, ai_rate_window_count
            from public.ai_usage_daily
            where user_id = p_user_id
            order by usage_date desc limit 1
        ), rolling as (
            -- Refunds release daily allowance, but keep their short-term admission.
            select count(*)::integer as used,
                min(created_at) + interval '60 seconds' as next_change,
                (array_agg(created_at order by created_at desc))[p_burst_limit] + interval '60 seconds' as retry_at
            from public.ai_quota_reservations, instant
            where p_burst_limit is not null and user_id = p_user_id
                and created_at > observed_at - interval '60 seconds'
        ), usage as (
            select observed_at,
                coalesce((select operation_count from public.ai_usage_daily
                    where user_id = p_user_id and usage_date = (observed_at at time zone 'utc')::date), 0) as daily_used,
                case when p_burst_limit is not null then rolling.used
                    when (select ai_rate_window_started_at from latest) > observed_at - interval '60 seconds'
                        then (select ai_rate_window_count from latest)
                    else 0 end as short_used,
                case when p_burst_limit is not null then rolling.next_change
                    when (select ai_rate_window_started_at from latest) > observed_at - interval '60 seconds'
                        then (select ai_rate_window_started_at from latest) + interval '60 seconds'
                    else null end as next_change,
                rolling.retry_at
            from instant cross join rolling
        )
        select jsonb_build_object(
            'observedAt', observed_at,
            'daily', jsonb_build_object(
                'limit', p_daily_limit, 'used', daily_used,
                'remaining', greatest(0, p_daily_limit - daily_used),
                'resetAt', (((observed_at at time zone 'utc')::date + 1)::timestamp at time zone 'utc')
            ),
            'shortTerm', jsonb_build_object(
                'mode', case when p_burst_limit is null then 'fixed' else 'rolling' end,
                'limit', coalesce(p_burst_limit, 5), 'used', short_used,
                'remaining', greatest(0, coalesce(p_burst_limit, 5) - short_used),
                'nextChangeAt', case when short_used > 0 then next_change else null end,
                'retryAt', case when short_used >= coalesce(p_burst_limit, 5)
                    then case when p_burst_limit is null then next_change else retry_at end
                    else null end
            )
        ) from usage
    );
end;
$$;

revoke all on function public.get_ai_usage_summary(uuid, integer, integer) from public;
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke execute on function public.get_ai_usage_summary(uuid, integer, integer) from anon;
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
        revoke execute on function public.get_ai_usage_summary(uuid, integer, integer) from authenticated;
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
        grant execute on function public.get_ai_usage_summary(uuid, integer, integer) to service_role;
    end if;
end;
$$;
