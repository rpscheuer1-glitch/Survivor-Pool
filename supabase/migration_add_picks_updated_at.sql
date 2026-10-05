-- Run this in Supabase SQL Editor (or just re-run sync_schema.sql, which
-- includes this too).

alter table picks add column if not exists updated_at timestamptz not null default now();

create or replace function set_picks_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists picks_set_updated_at on picks;
create trigger picks_set_updated_at
before update on picks
for each row
execute function set_picks_updated_at();

-- Full audit trail: keeps every value a pick has ever held, who changed it,
-- and when -- so a disputed "I picked X, it now shows Y" claim can actually
-- be checked later instead of being unresolvable.
create table if not exists pick_history (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  week int not null,
  old_team text,
  new_team text,
  old_auto_assigned boolean,
  new_auto_assigned boolean,
  changed_by uuid,
  changed_at timestamptz not null default now()
);

alter table pick_history enable row level security;

drop policy if exists "pick_history: admin read" on pick_history;
create policy "pick_history: admin read" on pick_history for select using (is_pool_admin());

create or replace function log_pick_history()
returns trigger as $$
begin
  if (tg_op = 'INSERT') then
    insert into pick_history (entry_id, week, old_team, new_team, old_auto_assigned, new_auto_assigned, changed_by)
    values (new.entry_id, new.week, null, new.team, null, new.auto_assigned, auth.uid());
  elsif (tg_op = 'UPDATE') then
    insert into pick_history (entry_id, week, old_team, new_team, old_auto_assigned, new_auto_assigned, changed_by)
    values (new.entry_id, new.week, old.team, new.team, old.auto_assigned, new.auto_assigned, auth.uid());
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists picks_log_history on picks;
create trigger picks_log_history
after insert or update on picks
for each row
execute function log_pick_history();
