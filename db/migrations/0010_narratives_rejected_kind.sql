-- generate-highlights.ts's "no game IDs given" mode looks for games with
-- no narratives row at all — a genuinely rejected narration (an ungrounded
-- claim the deterministic checks caught) stores nothing, so it looked
-- IDENTICAL to "never attempted" and got silently retried every single
-- run, forever. Harmless as a one-time backfill; real, recurring waste
-- once this runs on an hourly cron for a whole season — found live on the
-- first test run of that automation (31 games retried, same rejection,
-- every single time). 'rejected' lets a permanent failure be recorded
-- without pretending it succeeded, so it's excluded from future runs.
alter table narratives drop constraint narratives_kind_check;
alter table narratives add constraint narratives_kind_check check (kind in ('recap', 'highlights', 'rejected'));
