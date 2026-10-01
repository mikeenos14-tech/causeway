-- Derived tables (spec section 4), rebuilt from the nhl_* history by
-- scripts/stats/build-derived.ts. Each row carries the model_version and
-- computed_at the spec requires, so values can be rebuilt after backfills.

-- The era normalizer: league rates per regular season.
create table season_context (
  season text primary key,
  teams smallint not null,
  games integer not null,
  games_per_team numeric not null,
  goals_per_team_game numeric not null,
  shots_per_team_game numeric,          -- null when too few games have shots
  shots_coverage numeric not null,      -- share of games with shot totals
  pim_per_team_game numeric not null,
  ot_format text not null,
  shootout boolean not null,
  ties_possible boolean not null,
  model_version text not null,
  computed_at timestamptz not null default now()
);

-- Each game's state at the spec's checkpoints: end of P1 (1200s), end of P2
-- (2400s), 45:00, 50:00, 55:00, and the start of overtime when there was one.
create table game_state_snapshots (
  game_id integer not null references nhl_games(id) on delete cascade,
  checkpoint text not null,             -- 'P1', 'P2', '45:00', '50:00', '55:00', 'OT'
  elapsed_sec integer not null,
  home_goals smallint not null,
  away_goals smallint not null,
  home_shots smallint,                  -- null where the game has no shot events
  away_shots smallint,
  home_pim smallint,
  away_pim smallint,
  home_goals_last10 smallint not null,
  away_goals_last10 smallint not null,
  elo_diff numeric,                     -- filled by Phase 1 (Elo)
  model_version text not null,
  primary key (game_id, checkpoint)
);

-- Rest and schedule load per team per game. Travel fields stay null until
-- venues have coordinates.
create table team_rest (
  game_id integer not null references nhl_games(id) on delete cascade,
  team_id integer not null,
  is_home boolean not null,
  days_rest smallint,                   -- days since previous game, null for a season opener
  back_to_back boolean not null,
  games_last4 smallint not null,        -- games in the 4 nights before this one
  games_last7 smallint not null,
  road_trip_len smallint not null,      -- consecutive road games including this one (0 at home)
  homestand_return boolean not null,    -- first home game after a 4+ game road trip
  miles_from_prev numeric,
  miles_last7 numeric,
  tz_crossed smallint,
  model_version text not null,
  primary key (game_id, team_id)
);

revoke all on season_context, game_state_snapshots, team_rest from qa_readonly;
