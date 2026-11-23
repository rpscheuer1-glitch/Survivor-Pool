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

-- Admins can't see picks before lock (same as security_step3_hide_picks_from_admins.sql) --
-- Has every game in this week locked, or has the week been marked final?
create or replace function public.week_picks_revealed(p_week int)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select final from public.weeks where week = p_week), false)
    or coalesce((
      select bool_and(
        now() >= least(
          g.kickoff,
          public.game_lock_time(
            g.game_date,
            coalesce(w.weekend_lock_day, 'sunday'),
            coalesce(w.weekend_lock_time, '10:00')
          )
        )
      )
      from public.games g
      left join public.weeks w on w.week = g.week
      where g.week = p_week
        and (g.game_date is not null or g.kickoff is not null)
    ), false)
$$;

-- Only tightens the locked-down read rule (security_step2_lockdown.sql) if
-- it's in place; an open "read all" pool is left as it is.
do $$ begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'picks' and policyname = 'picks: read own or admin') then
    drop policy "picks: read own or admin" on public.picks;
    create policy "picks: read own or admin" on public.picks for select
      using (
        exists (select 1 from public.entries e where e.id = picks.entry_id and e.user_id = auth.uid())
        or (
          public.is_pool_admin()
          and (
            picks.auto_assigned
            or public.pick_is_locked(picks.week, picks.team)
            or public.week_picks_revealed(picks.week)
          )
        )
      );
  end if;
end $$;

drop policy if exists "pick_history: admin read" on public.pick_history;
create policy "pick_history: admin read" on public.pick_history for select
  using (
    public.is_pool_admin()
    and (
      public.week_picks_revealed(pick_history.week)
      or (
        (pick_history.old_team is null or public.pick_is_locked(pick_history.week, pick_history.old_team))
        and (pick_history.new_team is null or public.pick_is_locked(pick_history.week, pick_history.new_team))
      )
    )
  );

create or replace view public.pick_flags as
  select p.id, p.entry_id, p.week
  from public.picks p
  where public.is_pool_admin();

grant select on public.pick_flags to authenticated;

create or replace function public.admin_set_pick(p_entry_id uuid, p_week int, p_team text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_pool_admin() then
    raise exception 'Not authorized';
  end if;
  if p_team is null or p_team = '' then
    delete from public.picks where entry_id = p_entry_id and week = p_week;
  else
    insert into public.picks (entry_id, week, team, auto_assigned)
    values (p_entry_id, p_week, p_team, false)
    on conflict (entry_id, week) do update set team = excluded.team, auto_assigned = false;
  end if;
end;
$$;

revoke execute on function public.admin_set_pick(uuid, int, text) from public, anon;
grant execute on function public.admin_set_pick(uuid, int, text) to authenticated;

-- Notifications: site banner notices and phone push subscriptions.
-- dismisses it. user_id null = everyone; otherwise only that one person
-- (e.g. "your Week 5 pick was auto-assigned"). Created only by the server
-- (/api/notify, using the service-role key), so there's no insert policy.
create table if not exists notices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  title text not null,
  body text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create table if not exists notice_dismissals (
  notice_id uuid not null references notices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  dismissed_at timestamptz not null default now(),
  primary key (notice_id, user_id)
);

-- One row per phone/browser that turned on push notifications. Written only
-- by the server (/api/push/subscribe), so a device that changes hands between
-- accounts just gets re-pointed at whoever turned notifications on last.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table notices enable row level security;
drop policy if exists "notices: read own or everyone" on notices;
create policy "notices: read own or everyone" on notices for select using (
  auth.uid() is not null and (user_id is null or user_id = auth.uid())
);
drop policy if exists "notices: admin read all" on notices;
create policy "notices: admin read all" on notices for select using (is_pool_admin());
drop policy if exists "notices: admin delete" on notices;
create policy "notices: admin delete" on notices for delete using (is_pool_admin());

alter table notice_dismissals enable row level security;
drop policy if exists "notice_dismissals: read own" on notice_dismissals;
create policy "notice_dismissals: read own" on notice_dismissals for select using (auth.uid() = user_id);
drop policy if exists "notice_dismissals: insert own" on notice_dismissals;
create policy "notice_dismissals: insert own" on notice_dismissals for insert with check (auth.uid() = user_id);

alter table push_subscriptions enable row level security;
drop policy if exists "push_subscriptions: admin read" on push_subscriptions;
create policy "push_subscriptions: admin read" on push_subscriptions for select using (is_pool_admin());

-- Playoff pool (same as playoffs.sql) ----------------------------------------
-- PLAYOFF POOL -- additive only. Creates its own tables, rules, and views and
-- touches nothing the regular-season survivor pool uses, so it's safe to run
-- at any time, before or after deploying the code, and safe to re-run.
-- (sync_schema.sql includes this same block, so re-running that also does it.)
--
-- How the pool works (mirrored in lib/playoffLogic.js):
--   * Each round, each entry makes ONE pick: a side against the spread or the
--     over/under on one game. Win (cover) and you advance; lose and you're out.
--   * A round's lines freeze Wednesday 1:00 PM Central before its first game,
--     and picks open then. All of the round's picks lock together one hour
--     before its first kickoff, so nobody can wait on Saturday's results to
--     pick a Sunday game. Picks are revealed at that lock.
--   * No pick at the lock -> the round's biggest favorite (ties: earliest
--     kickoff).

-- Single row: whether the section shows for everyone, and whether new
-- playoff entries can be created.
create table if not exists playoff_settings (
  id int primary key default 1,
  visible boolean not null default false,
  entries_open boolean not null default false,
  season int not null default 2026
);
insert into playoff_settings (id) values (1) on conflict (id) do nothing;
-- Where players pay their entry fee (usernames only; shown as pay buttons).
alter table playoff_settings add column if not exists venmo_username text;
alter table playoff_settings add column if not exists paypal_username text;

-- One row per playoff game. round: 1 Wild Card, 2 Divisional, 3 Conference,
-- 4 Super Bowl. spread uses the same convention as games.spread (negative =
-- home favored). Scores are filled in when the game is final; picks are
-- graded from them.
create table if not exists playoff_games (
  id uuid primary key default gen_random_uuid(),
  round int not null check (round between 1 and 4),
  home text not null,
  away text not null,
  spread numeric not null default 0,
  total numeric,
  game_date date,
  kickoff timestamptz,
  home_score int,
  away_score int,
  created_at timestamptz not null default now()
);

-- Separate from the regular-season entries: up to 4 per account.
create table if not exists playoff_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  label text not null,
  created_at timestamptz not null default now()
);

create or replace function public.check_playoff_entry_limit()
returns trigger as $$
declare
  cnt int;
begin
  select count(*) into cnt from playoff_entries where user_id = new.user_id;
  if cnt >= 4 then
    raise exception 'Maximum of 4 playoff entries per account';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists enforce_playoff_entry_limit on playoff_entries;
create trigger enforce_playoff_entry_limit
  before insert on playoff_entries
  for each row execute function public.check_playoff_entry_limit();

-- Admins can still add entries while it's closed (e.g. to try it out).
create or replace function public.check_playoff_entries_open()
returns trigger as $$
begin
  if not coalesce((select entries_open from playoff_settings where id = 1), false)
     and not public.is_pool_admin() then
    raise exception 'Playoff entries are closed right now';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists enforce_playoff_entries_open on playoff_entries;
create trigger enforce_playoff_entries_open
  before insert on playoff_entries
  for each row execute function public.check_playoff_entries_open();

-- One pick per entry per round. game_id goes null if the admin deletes that
-- game, which voids the pick (the player is told to pick again).
create table if not exists playoff_picks (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references playoff_entries(id) on delete cascade,
  round int not null check (round between 1 and 4),
  game_id uuid references playoff_games(id) on delete set null,
  choice text not null check (choice in ('home', 'away', 'over', 'under')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entry_id, round)
);

create or replace function set_playoff_picks_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists playoff_picks_set_updated_at on playoff_picks;
create trigger playoff_picks_set_updated_at
before update on playoff_picks
for each row
execute function set_playoff_picks_updated_at();

-- Every value a pick has ever held, who changed it, and when.
create table if not exists playoff_pick_history (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references playoff_entries(id) on delete cascade,
  round int not null,
  old_game_id uuid,
  old_choice text,
  new_game_id uuid,
  new_choice text,
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create or replace function log_playoff_pick_history()
returns trigger as $$
begin
  if (tg_op = 'INSERT') then
    insert into playoff_pick_history (entry_id, round, old_game_id, old_choice, new_game_id, new_choice, changed_by)
    values (new.entry_id, new.round, null, null, new.game_id, new.choice, auth.uid());
  elsif (tg_op = 'UPDATE') then
    insert into playoff_pick_history (entry_id, round, old_game_id, old_choice, new_game_id, new_choice, changed_by)
    values (new.entry_id, new.round, old.game_id, old.choice, new.game_id, new.choice, auth.uid());
  elsif (tg_op = 'DELETE') then
    -- Skipped when the whole entry is being deleted, since its history goes with it.
    if exists (select 1 from playoff_entries where id = old.entry_id) then
      insert into playoff_pick_history (entry_id, round, old_game_id, old_choice, new_game_id, new_choice, changed_by)
      values (old.entry_id, old.round, old.game_id, old.choice, null, null, auth.uid());
    end if;
    return old;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists playoff_picks_log_history on playoff_picks;
create trigger playoff_picks_log_history
after insert or update or delete on playoff_picks
for each row
execute function log_playoff_pick_history();

-- How each person paid for their playoff entries (Admin > Playoffs).
create table if not exists playoff_payments (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text
);

-- Lock times -------------------------------------------------------------

-- A game's kickoff (noon Central on its date if no kickoff is set).
create or replace function public.playoff_game_lock_time(p_kickoff timestamptz, p_game_date date)
returns timestamptz
language sql
stable
as $$
  select coalesce(p_kickoff, (p_game_date + time '12:00') at time zone 'America/Chicago')
$$;

-- Lines freeze (and picks open) Wednesday 1:00 PM Central before the round's
-- first game -- for the Super Bowl, the Wednesday right before it.
create or replace function public.playoff_lines_lock_time(p_round int)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  with first_day as (
    select min(coalesce(g.game_date, (g.kickoff at time zone 'America/Chicago')::date)) as d
    from public.playoff_games g
    where g.round = p_round
  )
  select case
    when d is null then null
    else ((d - (((extract(dow from d)::int + 3) % 7) + 1)) + time '13:00') at time zone 'America/Chicago'
  end
  from first_day
$$;

-- Every pick in the round locks one hour before the round's first kickoff.
create or replace function public.playoff_round_lock_time(p_round int)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select min(public.playoff_game_lock_time(g.kickoff, g.game_date)) - interval '1 hour'
  from public.playoff_games g
  where g.round = p_round
$$;

create or replace function public.playoff_round_locked(p_round int)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(now() >= public.playoff_round_lock_time(p_round), false)
$$;

-- Can a participant pick this game right now? It has to be in that round,
-- and the round's lines must be frozen but its picks not yet locked.
create or replace function public.playoff_pick_open(p_round int, p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from public.playoff_games g where g.id = p_game_id and g.round = p_round)
    and coalesce(now() >= public.playoff_lines_lock_time(p_round), false)
    and not public.playoff_round_locked(p_round)
$$;

-- Row Level Security -------------------------------------------------------

alter table playoff_settings enable row level security;
drop policy if exists "playoff_settings: read all" on playoff_settings;
create policy "playoff_settings: read all" on playoff_settings for select using (true);
drop policy if exists "playoff_settings: admin write" on playoff_settings;
create policy "playoff_settings: admin write" on playoff_settings for update using (is_pool_admin());

alter table playoff_games enable row level security;
drop policy if exists "playoff_games: read all" on playoff_games;
create policy "playoff_games: read all" on playoff_games for select using (true);
drop policy if exists "playoff_games: admin insert" on playoff_games;
create policy "playoff_games: admin insert" on playoff_games for insert with check (is_pool_admin());
drop policy if exists "playoff_games: admin update" on playoff_games;
create policy "playoff_games: admin update" on playoff_games for update using (is_pool_admin());
drop policy if exists "playoff_games: admin delete" on playoff_games;
create policy "playoff_games: admin delete" on playoff_games for delete using (is_pool_admin());

-- A person sees their own entries; admins see all (with emails). Everyone
-- else uses the playoff_public_entries view below (names only).
alter table playoff_entries enable row level security;
drop policy if exists "playoff_entries: read own or admin" on playoff_entries;
create policy "playoff_entries: read own or admin" on playoff_entries for select
  using (auth.uid() = user_id or is_pool_admin());
drop policy if exists "playoff_entries: insert own" on playoff_entries;
create policy "playoff_entries: insert own" on playoff_entries for insert with check (auth.uid() = user_id);
drop policy if exists "playoff_entries: update own" on playoff_entries;
create policy "playoff_entries: update own" on playoff_entries for update using (auth.uid() = user_id);
drop policy if exists "playoff_entries: delete own or admin" on playoff_entries;
create policy "playoff_entries: delete own or admin" on playoff_entries for delete
  using (auth.uid() = user_id or is_pool_admin());

-- Picks: only ever your own, straight from the table -- admins included.
-- Everyone (admins too) sees other people's picks through
-- playoff_revealed_picks, which withholds them until the round locks.
-- Admins change picks through admin_set_playoff_pick.
alter table playoff_picks enable row level security;
drop policy if exists "playoff_picks: read own" on playoff_picks;
create policy "playoff_picks: read own" on playoff_picks for select
  using (exists (select 1 from playoff_entries e where e.id = playoff_picks.entry_id and e.user_id = auth.uid()));

drop policy if exists "playoff_picks: insert own" on playoff_picks;
create policy "playoff_picks: insert own" on playoff_picks for insert
  with check (
    exists (select 1 from playoff_entries e where e.id = playoff_picks.entry_id and e.user_id = auth.uid())
    and public.playoff_pick_open(playoff_picks.round, playoff_picks.game_id)
  );

drop policy if exists "playoff_picks: update own" on playoff_picks;
create policy "playoff_picks: update own" on playoff_picks for update
  using (
    exists (select 1 from playoff_entries e where e.id = playoff_picks.entry_id and e.user_id = auth.uid())
    and not public.playoff_round_locked(playoff_picks.round)
  )
  with check (
    exists (select 1 from playoff_entries e where e.id = playoff_picks.entry_id and e.user_id = auth.uid())
    and public.playoff_pick_open(playoff_picks.round, playoff_picks.game_id)
  );

drop policy if exists "playoff_picks: delete own" on playoff_picks;
create policy "playoff_picks: delete own" on playoff_picks for delete
  using (
    exists (select 1 from playoff_entries e where e.id = playoff_picks.entry_id and e.user_id = auth.uid())
    and not public.playoff_round_locked(playoff_picks.round)
  );

-- The change log: shows once that round's picks have locked.
alter table playoff_pick_history enable row level security;
drop policy if exists "playoff_pick_history: admin read" on playoff_pick_history;
create policy "playoff_pick_history: admin read" on playoff_pick_history for select
  using (is_pool_admin() and public.playoff_round_locked(playoff_pick_history.round));

alter table playoff_payments enable row level security;
drop policy if exists "playoff_payments: admin all" on playoff_payments;
create policy "playoff_payments: admin all" on playoff_payments for all
  using (is_pool_admin()) with check (is_pool_admin());

-- Spelled out in case this project doesn't grant new tables to the API roles
-- automatically. Row Level Security above still decides what each person can do.
grant select on playoff_settings, playoff_games to anon, authenticated;
grant update on playoff_settings to authenticated;
grant insert, update, delete on playoff_games to authenticated;
grant select, insert, update, delete on playoff_entries, playoff_picks, playoff_payments to authenticated;
grant select on playoff_pick_history to authenticated;

-- Public views ---------------------------------------------------------------
-- Names only (no emails), and no picks at all until the round locks. Admins
-- also see that an entry HAS a pick before then (game and side withheld), so
-- Admin > Playoffs can tell a hidden pick from a missing one. These run with
-- the owner's rights on purpose (Supabase's linter flags "security definer
-- views" -- that's expected here).
create or replace view public.playoff_public_entries as
  select id, label from public.playoff_entries;

create or replace view public.playoff_revealed_picks as
  select
    p.id,
    p.entry_id,
    p.round,
    case when public.playoff_round_locked(p.round) then p.game_id end as game_id,
    case when public.playoff_round_locked(p.round) then p.choice end as choice,
    public.playoff_round_locked(p.round) as revealed,
    p.game_id is null as voided
  from public.playoff_picks p
  where public.playoff_round_locked(p.round) or public.is_pool_admin();

grant select on public.playoff_public_entries to anon, authenticated;
grant select on public.playoff_revealed_picks to anon, authenticated;

-- Admin > Playoffs: set (or clear, with a null game) any entry's pick, even
-- one the admin can't see yet. The history trigger still records who did it.
create or replace function public.admin_set_playoff_pick(p_entry_id uuid, p_round int, p_game_id uuid, p_choice text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_pool_admin() then
    raise exception 'Not authorized';
  end if;
  if p_game_id is null then
    delete from public.playoff_picks where entry_id = p_entry_id and round = p_round;
  else
    if not exists (select 1 from public.playoff_games where id = p_game_id and round = p_round) then
      raise exception 'That game is not in this round';
    end if;
    insert into public.playoff_picks (entry_id, round, game_id, choice)
    values (p_entry_id, p_round, p_game_id, p_choice)
    on conflict (entry_id, round) do update set game_id = excluded.game_id, choice = excluded.choice;
  end if;
end;
$$;

revoke execute on function public.admin_set_playoff_pick(uuid, int, uuid, text) from public, anon;
grant execute on function public.admin_set_playoff_pick(uuid, int, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Activity log: IP + device behind every pick change and sign-in/visit.
-- (Same as migration_add_activity_log.sql.)
create table if not exists activity_log (
  id bigserial primary key,
  user_id uuid,              -- who did it (null = system / server action)
  event text not null,       -- sign_in, visit, pick, playoff_pick
  ip text,
  user_agent text,
  detail jsonb,
  created_at timestamptz not null default now()
);
-- No foreign key on user_id on purpose: the log survives an account deletion.

create index if not exists activity_log_user_idx on activity_log (user_id, created_at desc);
create index if not exists activity_log_ip_idx on activity_log (ip);

alter table activity_log enable row level security;
revoke all on activity_log from anon, authenticated;

create or replace function public.log_pick_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  h json;
  client_ip text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::json;
    client_ip := nullif(trim(split_part(coalesce(h->>'cf-connecting-ip', h->>'x-forwarded-for', ''), ',', 1)), '');
    insert into activity_log (user_id, event, ip, user_agent, detail)
    values (
      auth.uid(),
      tg_argv[0],
      client_ip,
      left(h->>'user-agent', 300),
      jsonb_build_object('op', lower(tg_op))
        || case when tg_op = 'DELETE' then jsonb_build_object('old', to_jsonb(old))
                else jsonb_build_object('new', to_jsonb(new)) end
    );
  exception when others then
    null; -- never let logging get in the way of saving a pick
  end;
  return null; -- AFTER trigger; return value is ignored
end;
$$;

drop trigger if exists picks_log_activity on picks;
create trigger picks_log_activity
after insert or update or delete on picks
for each row
execute function public.log_pick_activity('pick');

do $$
begin
  if to_regclass('public.playoff_picks') is not null then
    execute 'drop trigger if exists playoff_picks_log_activity on playoff_picks';
    execute 'create trigger playoff_picks_log_activity
             after insert or update or delete on playoff_picks
             for each row execute function public.log_pick_activity(''playoff_pick'')';
  end if;
end $$;
