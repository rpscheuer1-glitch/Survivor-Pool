-- SYNC SCRIPT — safe to run any time, in any state, as many times as you want.
-- This is the only migration file you need from now on. Every single policy
-- creation is wrapped so a duplicate/already-exists error can NEVER halt the
-- rest of the script (Supabase's SQL editor runs the whole paste as one
-- transaction, so previously, one early error would silently roll back
-- everything after it -- that's fixed here for good).
--
-- Run this in Supabase SQL Editor (new blank query -> paste this whole file -> Run).

-- Profiles: one row per signed-up user, auto-created on signup.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  is_admin boolean not null default false,
  payment_note text
);

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      new.email
    )
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Pool-wide settings (single row).
create table if not exists pool_settings (
  id int primary key default 1,
  pool_name text not null default 'Survivor Pool',
  current_week int not null default 1,
  signups_locked boolean not null default false
);
insert into pool_settings (id, pool_name, current_week)
  values (1, 'Survivor Pool', 1)
  on conflict (id) do nothing;

-- In case this column is what's missing from an earlier partial run.
alter table pool_settings add column if not exists signups_locked boolean not null default false;

-- Weeks: whether a given week's results are finalized.
create table if not exists weeks (
  week int primary key,
  final boolean not null default false,
  weekend_lock_day text not null default 'sunday',
  weekend_lock_time text not null default '10:00'
);
alter table weeks add column if not exists weekend_lock_day text not null default 'sunday';
alter table weeks add column if not exists weekend_lock_time text not null default '10:00';

-- Games: one row per matchup per week.
create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  week int not null,
  home text not null,
  away text not null,
  spread numeric not null default 0,
  winner text,
  favorite text,
  game_date date,
  created_at timestamptz not null default now()
);

-- Entries: up to 5 per account (enforced by trigger below).
create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  label text not null,
  created_at timestamptz not null default now()
);

create or replace function public.check_entry_limit()
returns trigger as $$
declare
  cnt int;
begin
  select count(*) into cnt from entries where user_id = new.user_id;
  if cnt >= 5 then
    raise exception 'Maximum of 5 entries per account';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists enforce_entry_limit on entries;
create trigger enforce_entry_limit
  before insert on entries
  for each row execute function public.check_entry_limit();

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

-- Picks: one pick per entry per week.
create table if not exists picks (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  week int not null,
  team text not null,
  auto_assigned boolean not null default false,
  created_at timestamptz not null default now(),
  unique (entry_id, week)
);

-- In case this column is missing from an earlier run.
alter table picks add column if not exists auto_assigned boolean not null default false;

-- SECURITY DEFINER makes this function's internal lookup bypass RLS, so a
-- policy that checks "is this user an admin" doesn't recursively trigger
-- itself when the check lives on the same table (profiles) being protected.
create or replace function public.is_pool_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

-- Row Level Security -------------------------------------------------------
-- Every policy below is wrapped in a DO block that catches "already exists"
-- and moves on, so this section can never halt partway through no matter
-- what state your database is already in.

alter table profiles enable row level security;
alter table pool_settings enable row level security;
alter table weeks enable row level security;
alter table games enable row level security;
alter table entries enable row level security;
alter table picks enable row level security;

do $$ begin
  create policy "profiles: read own" on profiles for select using (auth.uid() = id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "profiles: update own" on profiles for update using (auth.uid() = id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "profiles: admin read all" on profiles for select using (is_pool_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "profiles: admin update all" on profiles for update using (is_pool_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "pool_settings: read all" on pool_settings for select using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "pool_settings: admin write" on pool_settings for update using (is_pool_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "weeks: read all" on weeks for select using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "weeks: admin insert" on weeks for insert with check (is_pool_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "weeks: admin update" on weeks for update using (is_pool_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "games: read all" on games for select using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "games: admin insert" on games for insert with check (is_pool_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "games: admin update" on games for update using (is_pool_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "games: admin delete" on games for delete using (is_pool_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "entries: read all" on entries for select using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "entries: insert own" on entries for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "entries: update own" on entries for update using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "entries: delete own" on entries for delete using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "entries: admin delete" on entries for delete using (is_pool_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "picks: read all" on picks for select using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "picks: insert own" on picks for insert with check (
    exists (select 1 from entries where entries.id = picks.entry_id and entries.user_id = auth.uid())
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "picks: update own" on picks for update using (
    exists (select 1 from entries where entries.id = picks.entry_id and entries.user_id = auth.uid())
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "picks: delete own" on picks for delete using (
    exists (select 1 from entries where entries.id = picks.entry_id and entries.user_id = auth.uid())
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "picks: admin insert" on picks for insert with check (is_pool_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "picks: admin update" on picks for update using (is_pool_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "picks: admin delete" on picks for delete using (is_pool_admin());
exception when duplicate_object then null; end $$;
