-- Puts access back exactly as it was before security_step2_lockdown.sql.
begin;

drop policy if exists "entries: read own or admin" on public.entries;
drop policy if exists "entries: read all" on public.entries;
create policy "entries: read all" on public.entries for select using (true);

drop policy if exists "picks: read own or admin" on public.picks;
drop policy if exists "picks: read all" on public.picks;
create policy "picks: read all" on public.picks for select using (true);

drop policy if exists "picks: insert own" on public.picks;
create policy "picks: insert own" on public.picks for insert
  with check (exists (select 1 from public.entries where entries.id = picks.entry_id and entries.user_id = auth.uid()));

drop policy if exists "picks: update own" on public.picks;
create policy "picks: update own" on public.picks for update
  using (exists (select 1 from public.entries where entries.id = picks.entry_id and entries.user_id = auth.uid()));

drop policy if exists "picks: delete own" on public.picks;
create policy "picks: delete own" on public.picks for delete
  using (exists (select 1 from public.entries where entries.id = picks.entry_id and entries.user_id = auth.uid()));

commit;
