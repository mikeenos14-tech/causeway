-- Goalie per game and standings by date, for the stats engine (see
-- docs/signature-stats-map.md). Loaded by scripts/stats/load-nhl-extras.ts.

-- Who played in goal, who started, and who got the decision: Elo V2's
-- goalie adjustment and the Legs Score's goalie fatigue.
create table nhl_goalie_games (
  game_id integer not null references nhl_games(id) on delete cascade,
  player_id integer not null,
  team_id integer not null,
  started boolean not null,
  decision text check (decision in ('W', 'L', 'OTL', 'T')),
  toi_sec integer,
  shots_against smallint,
  saves smallint,
  goals_against smallint,
  primary key (game_id, player_id)
);
create index nhl_goalie_games_player_idx on nhl_goalie_games (player_id);

-- League standings as of each regular-season game date: divisions for the
-- Grudge Index, the playoff race and seeding for the Misery Meter.
create table nhl_standings (
  date date not null,
  season text not null,
  team_id integer not null,
  games_played smallint not null,
  wins smallint not null,
  losses smallint not null,
  ot_losses smallint not null,
  ties smallint not null,
  points smallint not null,
  goals_for smallint,
  goals_against smallint,
  division text,
  conference text,
  division_rank smallint,
  conference_rank smallint,
  league_rank smallint,
  wildcard_rank smallint,
  primary key (date, team_id)
);
create index nhl_standings_season_idx on nhl_standings (season, team_id);

revoke all on nhl_goalie_games, nhl_standings from qa_readonly;
