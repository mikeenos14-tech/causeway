-- Elo ratings (spec section 6), rebuilt from nhl_games by
-- scripts/stats/build-elo.ts. franchise_id here is the lineage id
-- (nhl_teams.lineage_id): one continuous club across moves and renames.
create table elo_history (
  franchise_id integer not null,
  game_id integer not null references nhl_games(id) on delete cascade,
  date date not null,
  rating_before numeric not null,
  rating_after numeric not null,
  expected numeric not null,
  result numeric not null,
  model_version text not null,
  computed_at timestamptz not null default now(),
  primary key (franchise_id, game_id)
);
create index elo_history_game_idx on elo_history (game_id);

create table elo_current (
  franchise_id integer primary key,
  rating numeric not null,
  last_game_date date not null,
  model_version text not null,
  updated_at timestamptz not null default now()
);

revoke all on elo_history, elo_current from qa_readonly;
