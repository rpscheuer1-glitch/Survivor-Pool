-- Run this in Supabase SQL Editor.
-- Needed so the app knows which team is favored in each game (not just the
-- spread number), for the "no pick -> biggest favorite" fallback rule.

alter table games add column if not exists favorite text;
