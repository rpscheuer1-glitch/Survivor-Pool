-- Run this in Supabase SQL Editor (safe to run more than once).
--
-- Records the IP address and device (browser user-agent) behind every pick
-- change and every sign-in / site visit, so a "are these two accounts the same
-- person?" question can be answered later.
--
--   * Picks (regular + playoff) are logged by a database trigger, reading the
--     IP from the request headers Supabase passes through. Nothing in the app
--     has to call it, and a logging failure can never block a pick from saving.
--   * Sign-ins / visits are logged by the site through /api/log-visit.
--
-- Nobody can read this table from the website (no RLS policies), only you from
-- the SQL editor and the server. Example lookups are at the bottom.

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

-- ---------------------------------------------------------------------------
-- Example lookups (copy one at a time into the SQL editor):
--
-- 1) Everything logged for two accounts, newest first:
--
--   select usr.email, a.event, a.ip, a.user_agent, a.created_at
--   from activity_log a join auth.users usr on usr.id = a.user_id
--   where lower(usr.email) in ('first@example.com', 'second@example.com')
--   order by a.created_at desc;
--
-- 2) IPs used by more than one account:
--
--   select a.ip, count(distinct a.user_id) as accounts,
--          string_agg(distinct usr.email, ', ') as emails,
--          min(a.created_at) as first_seen, max(a.created_at) as last_seen
--   from activity_log a join auth.users usr on usr.id = a.user_id
--   where a.ip is not null
--   group by a.ip
--   having count(distinct a.user_id) > 1
--   order by accounts desc, last_seen desc;
