-- Causeway (Bruins site) — NHL schema, full-league scope.
-- Natural keys throughout use the NHL's own ids (team, player, game) so
-- backfill data can be inserted directly without an id-mapping layer.

create table franchises (
  id integer primary key,
  name text not null
);

create table teams (
  id integer primary key,
  franchise_id integer not null references franchises(id),
  name text not null,
  abbrev text not null,
  city text,
  conference text,
  division text,
  first_season_id text,
  last_season_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_teams_franchise on teams(franchise_id);

-- A team's name/abbrev as actually used at a point in time (e.g. "Mighty
-- Ducks of Anaheim" vs "Anaheim Ducks" — same team_id, different era).
-- teams.name/abbrev holds the current identity for convenience; this
-- table is the source of truth for era-accurate narrative generation.
create table team_identities (
  id bigserial primary key,
  team_id integer not null references teams(id),
  name text not null,
  abbrev text not null,
  start_date date not null,
  end_date date,
  unique (team_id, start_date)
);
create index idx_team_identities_team on team_identities(team_id);

create table players (
  id integer primary key,
  full_name text not null,
  position text check (position in ('C', 'LW', 'RW', 'D', 'G')),
  shoots_catches char(1),
  birth_date date,
  birth_country text,
  height_cm smallint,
  weight_kg smallint,
  hof_inducted_year smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table seasons (
  id text primary key,
  start_date date,
  end_date date
);

-- Jersey numbers (and roster membership) are per team, per season — not a
-- static player attribute. Handles both trades and rare same-season
-- number changes at the season grain, which is enough for the "who wore
-- number 4 before Bobby Orr" class of question.
create table player_team_seasons (
  player_id integer not null references players(id),
  team_id integer not null references teams(id),
  season_id text not null references seasons(id),
  jersey_number smallint,
  primary key (player_id, team_id, season_id)
);
create index idx_pts_team_season on player_team_seasons(team_id, season_id);

-- Playoff series as their own entity, not inferred from date gaps between
-- games. This is what makes "when did the Bruins last blow a series lead
-- to Montreal" a reliable query instead of a fragile heuristic.
create table playoff_series (
  id bigserial primary key,
  season_id text not null references seasons(id),
  round smallint not null,
  team_a_id integer not null references teams(id),
  team_b_id integer not null references teams(id),
  winner_team_id integer references teams(id),
  games_played smallint
);
create index idx_series_season on playoff_series(season_id);

create table games (
  id integer primary key,
  season_id text not null references seasons(id),
  game_date date not null,
  game_datetime timestamptz,
  game_type text not null check (game_type in ('regular', 'playoff', 'preseason')),
  game_end_type text check (game_end_type in ('regulation', 'overtime', 'shootout')),
  series_id bigint references playoff_series(id),
  series_game_number smallint,
  home_team_id integer not null references teams(id),
  away_team_id integer not null references teams(id),
  home_score smallint,
  away_score smallint,
  venue text,
  attendance integer,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_games_season on games(season_id);
create index idx_games_home_team on games(home_team_id);
create index idx_games_away_team on games(away_team_id);
create index idx_games_date on games(game_date);
create index idx_games_series on games(series_id);

create table skater_game_stats (
  game_id integer not null references games(id),
  player_id integer not null references players(id),
  team_id integer not null references teams(id),
  goals smallint default 0,
  assists smallint default 0,
  points smallint generated always as (goals + assists) stored,
  shots smallint,
  hits smallint,
  blocked_shots smallint,
  giveaways smallint,
  takeaways smallint,
  faceoff_wins smallint,
  faceoff_losses smallint,
  penalty_minutes smallint,
  plus_minus smallint,
  pp_goals smallint,
  sh_goals smallint,
  gw_goals smallint,
  toi_seconds integer,
  source text,
  updated_at timestamptz not null default now(),
  primary key (game_id, player_id)
);
create index idx_skater_stats_player on skater_game_stats(player_id);
create index idx_skater_stats_team on skater_game_stats(team_id);

create table goalie_game_stats (
  game_id integer not null references games(id),
  player_id integer not null references players(id),
  team_id integer not null references teams(id),
  decision text check (decision in ('W', 'L', 'OTL')),
  shots_against smallint,
  saves smallint,
  goals_against smallint,
  save_pct numeric(5, 4),
  toi_seconds integer,
  shutout boolean default false,
  source text,
  updated_at timestamptz not null default now(),
  primary key (game_id, player_id)
);
create index idx_goalie_stats_player on goalie_game_stats(player_id);

create table team_game_stats (
  game_id integer not null references games(id),
  team_id integer not null references teams(id),
  shots_on_goal smallint,
  xg_for numeric(5, 2),
  xg_against numeric(5, 2),
  corsi_for smallint,
  corsi_against smallint,
  pp_goals smallint,
  pp_opportunities smallint,
  pk_goals_against smallint,
  pk_times_shorthanded smallint,
  hits smallint,
  faceoff_win_pct numeric(5, 2),
  source text,
  updated_at timestamptz not null default now(),
  primary key (game_id, team_id)
);

create table play_by_play (
  id bigserial primary key,
  game_id integer not null references games(id),
  period smallint not null,
  period_time_seconds smallint not null,
  event_type text not null check (event_type in (
    'goal', 'shot_on_goal', 'missed_shot', 'blocked_shot', 'penalty', 'faceoff',
    'hit', 'giveaway', 'takeaway', 'stoppage', 'period_start', 'period_end',
    'game_end', 'delayed_penalty', 'power_play_start', 'power_play_end'
  )),
  team_id integer references teams(id),
  primary_player_id integer references players(id),
  secondary_player_id integer references players(id),
  description text,
  x_coord smallint,
  y_coord smallint
);
create index idx_pbp_game on play_by_play(game_id);
create index idx_pbp_player on play_by_play(primary_player_id);

create table standings_snapshots (
  id bigserial primary key,
  team_id integer not null references teams(id),
  season_id text not null references seasons(id),
  snapshot_date date not null,
  division text,
  conference text,
  games_played smallint,
  wins smallint,
  losses smallint,
  ot_losses smallint,
  points smallint,
  points_pct numeric(4, 3),
  goals_for smallint,
  goals_against smallint,
  division_rank smallint,
  conference_rank smallint,
  league_rank smallint,
  source text,
  updated_at timestamptz not null default now(),
  unique (team_id, snapshot_date)
);
create index idx_standings_season on standings_snapshots(season_id);

create table narratives (
  game_id integer primary key references games(id),
  headline text,
  body text not null,
  source text not null default 'ai_generated',
  model_version text,
  generated_at timestamptz not null default now()
);

create table line_combinations (
  id bigserial primary key,
  team_id integer not null references teams(id),
  as_of_date date not null,
  line_number smallint not null,
  position_group text not null check (position_group in ('forward', 'defense')),
  toi_together_seconds integer,
  xgf_pct numeric(5, 2),
  source text,
  updated_at timestamptz not null default now(),
  unique (team_id, as_of_date, position_group, line_number)
);

create table line_combination_players (
  line_combination_id bigint not null references line_combinations(id),
  player_id integer not null references players(id),
  line_slot smallint not null,
  primary key (line_combination_id, player_id)
);

create table cap_records (
  id bigserial primary key,
  team_id integer not null references teams(id),
  player_id integer not null references players(id),
  season_id text not null references seasons(id),
  cap_hit numeric(10, 2),
  contract_years_remaining smallint,
  expiry_status text check (expiry_status in ('UFA', 'RFA') or expiry_status is null),
  source text,
  updated_at timestamptz not null default now(),
  unique (team_id, player_id, season_id)
);

-- Cheap, high fan-value trivia tables — the kind of thing that makes a
-- site feel like it has real institutional depth.
create table retired_numbers (
  id bigserial primary key,
  team_id integer not null references teams(id),
  player_id integer references players(id),
  jersey_number smallint not null,
  retired_date date,
  unique (team_id, jersey_number)
);

create table awards (
  id bigserial primary key,
  season_id text not null references seasons(id),
  award_name text not null,
  player_id integer not null references players(id),
  team_id integer references teams(id),
  unique (season_id, award_name, player_id)
);
create index idx_awards_player on awards(player_id);
