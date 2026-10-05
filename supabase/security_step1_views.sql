-- STEP 1 OF 2 -- additive only. Nothing here changes who can read or write
-- anything, so it is safe to run at any time, before or after deploying code.
-- (sync_schema.sql includes this same block, so re-running that also does it.)

alter table public.games add column if not exists kickoff timestamptz;

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
