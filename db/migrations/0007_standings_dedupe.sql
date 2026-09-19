-- Real bug found live during the full-league rollout (2026-09-18): the
-- standings snapshot date was computed from the *processing* team's own
-- last regular-season game date, not one canonical date per season. In a
-- heavily-rescheduled season (2020-21 in particular), different teams'
-- own "last game" dates differ by days, so each team's backfill run wrote
-- a standings row, dated to ITS OWN last-game date, for every other team
-- present in that day's league-wide standings snapshot. The old unique
-- constraint was on (team_id, snapshot_date), so each distinct date
-- produced a brand-new row instead of updating one canonical row per
-- team+season — 517 of 584 team-seasons (88%) already had duplicates,
-- some stuck on an incomplete (lower games_played) snapshot with no
-- guarantee the more-complete one would be picked by any query.
--
-- Fix: keep exactly one row per (team_id, season_id) — the one with the
-- most games_played (ties broken by the latest snapshot_date), since
-- games_played is monotonically non-decreasing across a season, so the
-- max is always the most complete/final snapshot we have. Then enforce
-- that as the real constraint going forward.

delete from standings_snapshots s
where s.id not in (
  select distinct on (team_id, season_id) id
  from standings_snapshots
  order by team_id, season_id, games_played desc, snapshot_date desc
);

alter table standings_snapshots drop constraint standings_snapshots_team_id_snapshot_date_key;
alter table standings_snapshots add constraint standings_snapshots_team_id_season_id_key unique (team_id, season_id);
