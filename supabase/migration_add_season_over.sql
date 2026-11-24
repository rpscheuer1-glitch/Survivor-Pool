-- Run this in Supabase SQL Editor (or just re-run sync_schema.sql, which
-- includes it). Safe to run more than once, and safe to run before or after
-- the matching site code deploys.
--
-- 1. "End season" switch: pool_settings.season_over + a message for players
--    (e.g. the winner). While it's on, players can't save or change picks.
-- 2. Lets admins delete weeks, so "Start new season" really clears last
--    season's weeks (and their "final" flags) instead of silently keeping them.

alter table pool_settings add column if not exists season_over boolean not null default false;
alter table pool_settings add column if not exists season_over_message text;

do $$ begin
  create policy "weeks: admin delete" on weeks for delete using (is_pool_admin());
exception when duplicate_object then null; end $$;

-- Players can't add or change picks once the season is over. Admins and the
-- server (no signed-in user) still can.
create or replace function public.check_season_not_over()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce((select season_over from pool_settings where id = 1), false)
     and auth.uid() is not null
     and not public.is_pool_admin() then
    raise exception 'The season is over, so picks are closed.';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_season_not_over on picks;
create trigger enforce_season_not_over
  before insert or update on picks
  for each row execute function public.check_season_not_over();
