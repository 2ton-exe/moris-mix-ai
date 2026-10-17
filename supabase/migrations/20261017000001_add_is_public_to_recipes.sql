alter table public.recipes add column if not exists is_public boolean not null default false;
update public.recipes set is_public = true where id = '11111111-1111-1111-1111-111111111111';
