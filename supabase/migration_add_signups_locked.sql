-- Run this in Supabase SQL Editor.

alter table pool_settings add column if not exists signups_locked boolean not null default false;

-- Real enforcement (not just hiding the button): blocks new entries at the
-- database level whenever the pool is locked, regardless of how the request
-- to insert one is made.
create or replace function public.check_signups_not_locked()
returns trigger as $$
declare
  locked boolean;
begin
  select signups_locked into locked from pool_settings where id = 1;
  if locked then
    raise exception 'Sign-ups and new entries are currently locked for this pool';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists enforce_signups_not_locked on entries;
create trigger enforce_signups_not_locked
  before insert on entries
  for each row execute function public.check_signups_not_locked();
