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
-- Exact kickoff (from the schedule sync). Used so a game that starts before
-- the weekend deadline locks at kickoff instead.
alter table games add column if not exists kickoff timestamptz;

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
  updated_at timestamptz not null default now(),
  unique (entry_id, week)
);
alter table picks add column if not exists updated_at timestamptz not null default now();

-- Automatically stamps updated_at on every change to a pick -- covers the
-- participant's own edits, admin overrides in Manage Picks, and the lock-in
-- tool, since all of them go through a plain UPDATE/upsert on this table.
create or replace function set_picks_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists picks_set_updated_at on picks;
create trigger picks_set_updated_at
before update on picks
for each row
execute function set_picks_updated_at();

-- Full audit trail: unlike the picks table itself (which only ever holds the
-- CURRENT value for an entry+week), this keeps every value a pick has ever
-- held, who changed it, and when -- so a disputed "I picked X, it now shows
-- Y" claim can actually be checked later instead of being unresolvable.
create table if not exists pick_history (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  week int not null,
  old_team text,
  new_team text,
  old_auto_assigned boolean,
  new_auto_assigned boolean,
  changed_by uuid,
  changed_at timestamptz not null default now()
);

alter table pick_history enable row level security;


create or replace function log_pick_history()
returns trigger as $$
begin
  if (tg_op = 'INSERT') then
    insert into pick_history (entry_id, week, old_team, new_team, old_auto_assigned, new_auto_assigned, changed_by)
    values (new.entry_id, new.week, null, new.team, null, new.auto_assigned, auth.uid());
  elsif (tg_op = 'UPDATE') then
    insert into pick_history (entry_id, week, old_team, new_team, old_auto_assigned, new_auto_assigned, changed_by)
    values (new.entry_id, new.week, old.team, new.team, old.auto_assigned, new.auto_assigned, auth.uid());
  elsif (tg_op = 'DELETE') then
    -- A cleared pick (new_team null). Skipped when the whole entry is being
    -- deleted, since its history goes with it.
    if exists (select 1 from entries where id = old.entry_id) then
      insert into pick_history (entry_id, week, old_team, new_team, old_auto_assigned, new_auto_assigned, changed_by)
      values (old.entry_id, old.week, old.team, null, old.auto_assigned, null, auth.uid());
    end if;
    return old;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists picks_log_history on picks;
create trigger picks_log_history
after insert or update or delete on picks
for each row
execute function log_pick_history();

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

-- Nobody but an admin may change is_admin or payment_note -- including on
-- their own row, which "profiles: update own" would otherwise allow (letting
-- any signed-in user make themselves an admin through the public API key).
-- Changes made from the Supabase dashboard / SQL editor or the service-role
-- key have no signed-in user (auth.uid() is null) and are still allowed.
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_pool_admin()
     and (new.is_admin is distinct from old.is_admin
          or new.payment_note is distinct from old.payment_note) then
    raise exception 'Only an admin can change is_admin or payment_note';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_fields on profiles;
create trigger profiles_protect_fields
  before update on profiles
  for each row execute function public.protect_profile_fields();

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

-- Only create the open "read all" rule if the stricter one from
-- security_step2_lockdown.sql isn't in place -- otherwise re-running this
-- script would quietly undo the lockdown.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'entries' and policyname = 'entries: read own or admin') then
    create policy "entries: read all" on entries for select using (true);
  end if;
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
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'picks' and policyname = 'picks: read own or admin') then
    create policy "picks: read all" on picks for select using (true);
  end if;
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

do $$ begin
  create policy "pick_history: admin read" on pick_history for select using (is_pool_admin());
exception when duplicate_object then null; end $$;

-- Lock times + public-safe views (same as security_step1_views.sql) ----------
-- STEP 1 OF 2 -- additive only. Nothing here changes who can read or write
-- anything, so it is safe to run at any time, before or after deploying code.
-- (sync_schema.sql includes this same block, so re-running that also does it.)

-- When is a game's pick deadline? Mirrors computeDeadline() in lib/poolLogic.js:
--   Wed/Thu/Fri games -> 6:00 PM Central the same day
--   Sat/Sun/Mon games -> the week's weekend deadline (Saturday or Sunday of
--                        that Sat/Sun/Mon cluster, at the configured time)
create or replace function public.game_lock_time(
  p_game_date date, p_weekend_day text, p_weekend_time text
)
returns timestamptz
language sql
stable
as $$
  select case
    when p_game_date is null then null
    when extract(dow from p_game_date)::int in (3, 4, 5) then
      ((p_game_date + time '18:00') at time zone 'America/Chicago')
    else
      (((p_game_date
          - (case extract(dow from p_game_date)::int when 6 then 0 when 0 then 1 when 1 then 2 else 0 end)
          + (case when p_weekend_day = 'saturday' then 0 else 1 end))::timestamp
         + coalesce(nullif(p_weekend_time, ''), '10:00')::time) at time zone 'America/Chicago')
  end
$$;

-- Has the game this team plays in this week locked yet? A game also locks at
-- its own kickoff if that comes before the deadline above (e.g. a 9:30 AM ET
-- London game), mirroring computeLockTime() in lib/poolLogic.js.
create or replace function public.pick_is_locked(p_week int, p_team text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(bool_or(
    now() >= least(
      g.kickoff,
      public.game_lock_time(
        g.game_date,
        coalesce(w.weekend_lock_day, 'sunday'),
        coalesce(w.weekend_lock_time, '10:00')
      )
    )
  ), false)
  from public.games g
  left join public.weeks w on w.week = g.week
  where g.week = p_week
    and (g.home = p_team or g.away = p_team)
    and (g.game_date is not null or g.kickoff is not null)
$$;

-- What the public Weekly Summary is allowed to see: entry names only (no
-- emails), and only picks whose game has already locked. These views run with
-- the table owner's rights on purpose, so they can show that limited slice
-- even after the underlying tables are locked down. (Supabase's security
-- linter flags "security definer views" -- that's expected here.)
create or replace view public.public_entries as
  select id, label from public.entries;

create or replace view public.revealed_picks as
  select p.id, p.entry_id, p.week, p.team, p.auto_assigned
  from public.picks p
  where public.pick_is_locked(p.week, p.team);

grant select on public.public_entries to anon, authenticated;
grant select on public.revealed_picks to anon, authenticated;
