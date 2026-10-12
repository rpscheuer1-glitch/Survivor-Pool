-- Run this in Supabase SQL Editor (or just re-run sync_schema.sql, which
-- includes this too).

-- Notices: the banner shown at the top of the site until each person
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
