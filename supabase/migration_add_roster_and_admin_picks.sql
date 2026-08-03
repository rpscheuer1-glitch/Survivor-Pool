-- Run this in Supabase SQL Editor.

-- Payment tracking field on each account.
alter table profiles add column if not exists payment_note text;

-- Admin needs to see and edit every profile (not just their own) to run the roster.
create policy "profiles: admin read all" on profiles for select using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true)
);
create policy "profiles: admin update all" on profiles for update using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true)
);

-- Admin needs to set/change/clear picks on behalf of any entry (e.g. a phoned-in pick).
create policy "picks: admin insert" on picks for insert with check (
  exists (select 1 from profiles where profiles.id = auth.uid() and profiles.is_admin = true)
);
create policy "picks: admin update" on picks for update using (
  exists (select 1 from profiles where profiles.id = auth.uid() and profiles.is_admin = true)
);
create policy "picks: admin delete" on picks for delete using (
  exists (select 1 from profiles where profiles.id = auth.uid() and profiles.is_admin = true)
);

-- Was missing before -- lets a participant clear their own pick if ever needed.
create policy "picks: delete own" on picks for delete using (
  exists (select 1 from entries where entries.id = picks.entry_id and entries.user_id = auth.uid())
);
