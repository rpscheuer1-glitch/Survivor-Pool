-- STEP 3 -- admins can't see a pick before its game locks, either.
-- Run this AFTER security_step2_lockdown.sql (and after deploying the code
-- that goes with it). Safe to re-run. sync_schema.sql keeps it in place.
--
-- Before this, admin accounts could read every pick (and the pick change log
-- behind Manage Picks > History) at any time -- the site only hid them on
-- screen. Now the database itself withholds them: an admin sees another
-- person's pick only once that game has locked, or once the whole week has
-- locked or been marked final. Admin tools still learn WHETHER an entry has a
-- pick (pick_flags), and can still set or clear one (admin_set_pick), without
-- seeing what's there. (Anyone with the Supabase project login can still
-- open the raw tables in the Supabase dashboard -- this can't stop that.)

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

begin;

-- READING picks: your own, always. Someone else's (admins only) once that
-- game has locked, once the whole week has, or if the lock-in tool assigned
-- it (those come from the published rule, not a person's choice).
drop policy if exists "picks: read all" on public.picks;
drop policy if exists "picks: read own or admin" on public.picks;
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

-- The change log: a row shows only once every team in it has locked (or the
-- week has), so "Bills -> Chiefs" can't leak a pick early.
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

commit;

-- Which entries have a pick for which week -- no team. Lets admin tools (the
-- missing-picks email list, the lock-in tool, Manage Picks) tell "no pick"
-- apart from "pick you can't see yet".
create or replace view public.pick_flags as
  select p.id, p.entry_id, p.week
  from public.picks p
  where public.is_pool_admin();

grant select on public.pick_flags to authenticated;

-- Manage Picks: set (or clear, with a null team) any entry's pick, even one
-- the admin can't see yet. Runs with the owner's rights so it can replace a
-- hidden pick; the pick_history trigger still records which admin did it.
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
