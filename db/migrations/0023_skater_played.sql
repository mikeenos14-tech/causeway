-- Whether the player actually played (from the NHL's per-player game logs,
-- scripts/stats/load-nhl-appearances.ts). Old boxscores also list players
-- who didn't play, with all zeros. Null until the logs are loaded; nothing
-- is shown from a game or season whose rows aren't all marked.
alter table nhl_skater_games add column if not exists played boolean;
