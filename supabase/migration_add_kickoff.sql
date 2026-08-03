-- Run this in Supabase SQL Editor if you already ran schema.sql before this update.
-- (If you're setting up fresh, this is already included in schema.sql — no need to run both.)

alter table games add column if not exists kickoff timestamptz;
