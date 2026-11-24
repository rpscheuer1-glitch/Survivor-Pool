-- Run this in Supabase SQL Editor (or just re-run sync_schema.sql, which
-- includes it). Safe to run more than once.
--
-- Barred players: anyone whose account email is on this list can still sign
-- in and see their old entries, but can't create new regular-season or
-- playoff entries. They get the message below instead.
--
-- To bar someone:   insert into blocked_emails (email, note) values ('x@y.com', 'why');
-- To un-bar:        delete from blocked_emails where email = 'x@y.com';
-- Emails are matched case-insensitively.

create table if not exists blocked_emails (
  email text primary key,
  note text,
  created_at timestamptz not null default now()
);

-- Nobody can read or change this list from the website, only you from the
-- SQL editor (RLS on, no policies).
alter table blocked_emails enable row level security;
revoke all on blocked_emails from anon, authenticated;

create or replace function public.check_entry_not_blocked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  acct_email text;
begin
  -- Check the account's real sign-in email, not just the email column the
  -- page sends, so it can't be dodged by sending a different one.
  select u.email into acct_email from auth.users u where u.id = new.user_id;
  if exists (
    select 1 from blocked_emails b
    where lower(b.email) in (lower(coalesce(acct_email, '')), lower(coalesce(new.email, '')))
  ) then
    raise exception 'This account isn''t eligible to join this pool. Contact the pool admin with questions.';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_entry_not_blocked on entries;
create trigger enforce_entry_not_blocked
  before insert on entries
  for each row execute function public.check_entry_not_blocked();

do $$
begin
  if to_regclass('public.playoff_entries') is not null then
    execute 'drop trigger if exists enforce_playoff_entry_not_blocked on playoff_entries';
    execute 'create trigger enforce_playoff_entry_not_blocked
               before insert on playoff_entries
               for each row execute function public.check_entry_not_blocked()';
  end if;
end $$;

-- The actual emails are added by hand in the SQL editor (see the insert
-- example at the top) so players' addresses never end up in the repo.
-- Check:  select * from blocked_emails;
