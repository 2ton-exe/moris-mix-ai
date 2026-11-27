-- Reconstruct only the Auth binding from migration 20261013000000.
-- Run this file last in the existing Stage B --single-transaction replay.
SET LOCAL search_path = pg_catalog;
DO $contract$
BEGIN
    IF (
        SELECT count(*) FROM pg_catalog.pg_class
        WHERE oid IN ('auth.users'::regclass, 'public.profiles'::regclass)
          AND relkind IN ('r', 'p')
    ) <> 2 THEN
        RAISE EXCEPTION 'Auth and profile targets are incompatible';
    END IF;
    IF NOT EXISTS (
        SELECT FROM supabase_migrations.schema_migrations
        WHERE version = '20261013000000'
    ) OR NOT EXISTS (
        SELECT FROM pg_catalog.pg_proc AS handler
        JOIN pg_catalog.pg_language AS language ON language.oid = handler.prolang
        WHERE handler.oid = pg_catalog.to_regprocedure('public.handle_new_user()')
          AND language.lanname = 'plpgsql'
          AND handler.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
          AND handler.prosecdef
          AND handler.proconfig = ARRAY['search_path=public, extensions, pg_temp']
          AND pg_catalog.pg_get_userbyid(handler.proowner) IN ('postgres', 'supabase_admin')
          -- Preserve every body byte except the CR in a CRLF pair.
          AND pg_catalog.replace(handler.prosrc, E'\r\n', E'\n') COLLATE pg_catalog."C" =
              pg_catalog.replace($expected$
begin
    insert into public.profiles (id, display_name, avatar_url)
    values (
        new.id,
        coalesce(new.raw_user_meta_data->>'full_name', new.email),
        new.raw_user_meta_data->>'avatar_url'
    )
    on conflict (id) do nothing;
    return new;
end;
$expected$, E'\r\n', E'\n')
    ) THEN
        RAISE EXCEPTION 'Reviewed Auth profile migration or function is incompatible';
    END IF;
END
$contract$;

-- A conflicting target trigger is an error. Do not replace or disable it.
create trigger on_auth_user_created
    after insert on auth.users
    for each row
    execute function public.handle_new_user();

DO $binding$
BEGIN
    IF NOT EXISTS (
        SELECT FROM pg_catalog.pg_trigger
        WHERE tgrelid = 'auth.users'::regclass AND tgname = 'on_auth_user_created'
          AND NOT tgisinternal AND tgenabled = 'O' AND tgtype = 5
          AND tgnargs = 0 AND tgqual IS NULL
          AND tgfoid = 'public.handle_new_user()'::regprocedure
    ) THEN
        RAISE EXCEPTION 'Auth profile trigger binding is incompatible';
    END IF;
END
$binding$;

SAVEPOINT restore_auth_profile_probe;
SET LOCAL session_replication_role = origin;
SELECT pg_catalog.gen_random_uuid() AS restore_probe_id \gset
SELECT pg_catalog.set_config('mori_restore.probe_id', :'restore_probe_id', true)
    AS restore_probe_setting \gset
SET LOCAL ROLE supabase_auth_admin;
INSERT INTO auth.users (id, email, aud, role)
VALUES (:'restore_probe_id'::uuid, 'mori-restore-probe-' || :'restore_probe_id' || '@example.invalid',
        'authenticated', 'authenticated');
RESET ROLE;
DO $probe$
DECLARE
    probe uuid := pg_catalog.current_setting('mori_restore.probe_id')::uuid;
BEGIN
    IF (SELECT count(*) FROM public.profiles WHERE id = probe) <> 1
       OR NOT EXISTS (
           SELECT FROM public.profiles
           WHERE id = probe AND display_name = 'mori-restore-probe-' || probe::text || '@example.invalid'
       )
    THEN
        RAISE EXCEPTION 'Auth writer did not create the expected profile';
    END IF;
END
$probe$;
ROLLBACK TO SAVEPOINT restore_auth_profile_probe;
RELEASE SAVEPOINT restore_auth_profile_probe;
