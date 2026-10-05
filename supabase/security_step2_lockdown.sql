-- STEP 2 OF 2 -- tightens access. Run this ONLY AFTER:
--   1. security_step1_views.sql (or sync_schema.sql) has been run,
--   2. SUPABASE_SERVICE_ROLE_KEY is set in Vercel, and
--   3. the new code is deployed and the Weekly Summary loads correctly.
-- To undo everything here, run security_rollback.sql.

begin;

-- READING: a person sees only their own entries and picks; admins see all.
-- (The public Weekly Summary uses the views from step 1 instead.)
drop policy if exists "entries: read all" on public.entries;
drop policy if exists "entries: read own or admin" on public.entries;
create policy "entries: read own or admin" on public.entries for select
  using (auth.uid() = user_id or public.is_pool_admin());

drop policy if exists "picks: read all" on public.picks;
drop policy if exists "picks: read own or admin" on public.picks;
create policy "picks: read own or admin" on public.picks for select
  using (
    public.is_pool_admin()
    or exists (select 1 from public.entries e where e.id = picks.entry_id and e.user_id = auth.uid())
  );

-- WRITING: participants can't add, change, or remove a pick for a game that
-- has already locked, even by calling the API directly. Admin policies are
-- untouched, so Manage Picks can still override after a lock.
drop policy if exists "picks: insert own" on public.picks;
create policy "picks: insert own" on public.picks for insert
  with check (
    exists (select 1 from public.entries where entries.id = picks.entry_id and entries.user_id = auth.uid())
    and not public.pick_is_locked(picks.week, picks.team)
  );

drop policy if exists "picks: update own" on public.picks;
create policy "picks: update own" on public.picks for update
  using (
    exists (select 1 from public.entries where entries.id = picks.entry_id and entries.user_id = auth.uid())
    and not public.pick_is_locked(picks.week, picks.team)
  )
  with check (
    exists (select 1 from public.entries where entries.id = picks.entry_id and entries.user_id = auth.uid())
    and not public.pick_is_locked(picks.week, picks.team)
  );

drop policy if exists "picks: delete own" on public.picks;
create policy "picks: delete own" on public.picks for delete
  using (
    exists (select 1 from public.entries where entries.id = picks.entry_id and entries.user_id = auth.uid())
    and not public.pick_is_locked(picks.week, picks.team)
  );

commit;
