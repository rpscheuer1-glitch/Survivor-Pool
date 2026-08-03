-- Run this in Supabase SQL Editor.
-- Replaces the earlier "kickoff" timestamp idea with a simpler date-only field,
-- since the lock rules only ever need to know which calendar day a game falls on.

alter table games add column if not exists game_date date;

-- The old "kickoff" column (if you ran the previous migration) is no longer used
-- by the app and can be left as-is or dropped — entirely optional:
-- alter table games drop column if exists kickoff;
