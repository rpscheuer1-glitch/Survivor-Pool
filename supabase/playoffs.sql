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
