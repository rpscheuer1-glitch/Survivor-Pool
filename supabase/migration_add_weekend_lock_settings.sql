-- Run this in Supabase SQL Editor (or just re-run sync_schema.sql, which
-- includes this too).

alter table weeks add column if not exists weekend_lock_day text not null default 'sunday';
alter table weeks add column if not exists weekend_lock_time text not null default '10:00';
