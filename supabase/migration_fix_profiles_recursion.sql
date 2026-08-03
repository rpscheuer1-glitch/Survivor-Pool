-- Run this in Supabase SQL Editor. Fixes a bug from the last migration:
-- a policy on `profiles` that queries `profiles` itself causes Postgres to
-- recheck that same policy recursively, which breaks access to the table
-- entirely (including your own admin check) -- that's why Admin disappeared.

drop policy if exists "profiles: admin read all" on profiles;
drop policy if exists "profiles: admin update all" on profiles;

-- SECURITY DEFINER makes this function's internal lookup bypass RLS, so it
-- can safely check is_admin without triggering the same recursive problem.
create or replace function public.is_pool_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

create policy "profiles: admin read all" on profiles for select using (is_pool_admin());
create policy "profiles: admin update all" on profiles for update using (is_pool_admin());
