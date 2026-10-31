create table if not exists public.ai_quota_reservations (
    id uuid primary key,
    daily_usage_id uuid not null references public.ai_usage_daily(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    status text not null check (status in ('reserved', 'confirmed', 'refunded')),
    refund_reason text,
    refunded_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_ai_quota_reservations_daily_id
    on public.ai_quota_reservations(daily_usage_id);

create index if not exists idx_ai_quota_reservations_user_created
    on public.ai_quota_reservations(user_id, created_at desc);

drop trigger if exists tr_ai_quota_reservations_updated_at on public.ai_quota_reservations;
create trigger tr_ai_quota_reservations_updated_at
    before update on public.ai_quota_reservations
    for each row
    execute function public.set_updated_at();

alter table public.ai_quota_reservations enable row level security;
revoke all on table public.ai_quota_reservations from public;
revoke all on table public.ai_quota_reservations from authenticated;
grant all on table public.ai_quota_reservations to service_role;

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
    v_existing_user_id uuid;
    v_existing_status text;
    v_existing_date date;
begin
    if auth.role() <> 'service_role' then
        raise exception 'Unauthorized quota operation' using errcode = '42501';
    end if;

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
        insert into public.ai_usage_daily (user_id, usage_date, operation_count)
        values (p_user_id, v_usage_date, 0)
        on conflict (user_id, usage_date) do nothing;

        select id, operation_count into v_daily_id, v_current_count
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

    insert into public.ai_quota_reservations (id, daily_usage_id, user_id, status)
    values (p_reservation_id, v_daily_id, p_user_id, 'reserved');

    update public.ai_usage_daily
    set operation_count = operation_count + 1,
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

create or replace function public.confirm_ai_quota(
    p_reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_status text;
begin
    if auth.role() <> 'service_role' then
        raise exception 'Unauthorized quota operation' using errcode = '42501';
    end if;

    select status into v_status
    from public.ai_quota_reservations
    where id = p_reservation_id
    for update;

    if not found then
        return jsonb_build_object('confirmed', false, 'status', 'not_found');
    end if;

    if v_status = 'confirmed' then
        return jsonb_build_object('confirmed', true, 'status', 'confirmed');
    end if;

    if v_status <> 'reserved' then
        return jsonb_build_object('confirmed', false, 'status', v_status);
    end if;

    update public.ai_quota_reservations
    set status = 'confirmed',
        updated_at = now()
    where id = p_reservation_id;

    return jsonb_build_object('confirmed', true, 'status', 'confirmed');
end;
$$;

create or replace function public.reconcile_ai_quota(
    p_reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_daily_id uuid;
    v_status text;
    v_new_count integer;
begin
    if auth.role() <> 'service_role' then
        raise exception 'Unauthorized quota operation' using errcode = '42501';
    end if;

    select daily_usage_id, status into v_daily_id, v_status
    from public.ai_quota_reservations
    where id = p_reservation_id
    for update;

    if not found then
        return jsonb_build_object('reconciled', false, 'status', 'not_found');
    end if;

    if v_status <> 'reserved' then
        return jsonb_build_object('reconciled', false, 'status', v_status);
    end if;

    update public.ai_quota_reservations
    set status = 'refunded',
        refund_reason = 'provider_failure_rollback',
        refunded_at = now(),
        updated_at = now()
    where id = p_reservation_id;

    update public.ai_usage_daily
    set operation_count = greatest(0, operation_count - 1),
        updated_at = now()
    where id = v_daily_id
    returning operation_count into v_new_count;

    return jsonb_build_object('reconciled', true, 'status', 'refunded', 'used', coalesce(v_new_count, 0));
end;
$$;

create or replace function public.reconcile_unconfirmed_reservation(
    p_reservation_id uuid,
    p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_daily_id uuid;
    v_status text;
    v_new_count integer;
begin
    if auth.role() <> 'service_role' then
        raise exception 'Unauthorized quota operation' using errcode = '42501';
    end if;

    if p_reason is null or trim(p_reason) = '' then
        raise exception 'Audit reason is required' using errcode = '22023';
    end if;

    select daily_usage_id, status into v_daily_id, v_status
    from public.ai_quota_reservations
    where id = p_reservation_id
    for update;

    if not found then
        return jsonb_build_object('reconciled', false, 'status', 'not_found');
    end if;

    if v_status = 'confirmed' then
        raise exception 'Cannot refund confirmed reservation' using errcode = '22000';
    end if;

    if v_status = 'refunded' then
        return jsonb_build_object('reconciled', false, 'status', 'already_refunded');
    end if;

    update public.ai_quota_reservations
    set status = 'refunded',
        refund_reason = trim(p_reason),
        refunded_at = now(),
        updated_at = now()
    where id = p_reservation_id;

    update public.ai_usage_daily
    set operation_count = greatest(0, operation_count - 1),
        updated_at = now()
    where id = v_daily_id
    returning operation_count into v_new_count;

    return jsonb_build_object('reconciled', true, 'status', 'refunded', 'used', coalesce(v_new_count, 0));
end;
$$;

revoke all on function public.consume_ai_quota(uuid, uuid, integer, date) from public;
revoke all on function public.consume_ai_quota(uuid, uuid, integer, date) from authenticated;
grant execute on function public.consume_ai_quota(uuid, uuid, integer, date) to service_role;

revoke all on function public.confirm_ai_quota(uuid) from public;
revoke all on function public.confirm_ai_quota(uuid) from authenticated;
grant execute on function public.confirm_ai_quota(uuid) to service_role;

revoke all on function public.reconcile_ai_quota(uuid) from public;
revoke all on function public.reconcile_ai_quota(uuid) from authenticated;
grant execute on function public.reconcile_ai_quota(uuid) to service_role;

revoke all on function public.reconcile_unconfirmed_reservation(uuid, text) from public;
revoke all on function public.reconcile_unconfirmed_reservation(uuid, text) from authenticated;
grant execute on function public.reconcile_unconfirmed_reservation(uuid, text) to service_role;
