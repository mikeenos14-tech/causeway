-- Signature Stats data layer (Phase 0): every NHL game since 1917-18 with
-- its goal and penalty events, loaded from the NHL's public API.
--
-- Deliberately separate from the site's own games/*_game_stats tables.
-- Those are the box-score tables every page, recap and Ask answer reads,
-- and they start in 2007-08; mixing 90 years of score-and-events-only
-- games into them would silently change "since 2007-08" claims, records
-- pages and head-to-head counts across the site. The nhl_* tables are the
-- stats engine's own complete history; the audit checks they agree with
-- games wherever both exist.

create table nhl_franchises (
  id integer primary key,               -- the NHL's franchise id
  name text not null,
  first_season text not null,
  last_season text                      -- null = active
);

create table nhl_teams (
  id integer primary key,               -- the NHL's team id (same ids as teams.id)
  franchise_id integer references nhl_franchises(id),
  -- The continuity Elo and Grudge follow. Usually the franchise; differs
  -- where the site deliberately decides otherwise (config/stats.ts).
  lineage_id integer not null,
  tri_code text not null,
  full_name text not null
);

create table nhl_players (
  id integer primary key,
  full_name text not null,
  position text
);

create table nhl_games (
  id integer primary key,
  season text not null,                 -- '19171918'
  game_type text not null check (game_type in ('regular', 'playoff')),
  game_date date not null,
  start_time_utc timestamptz,
  home_team_id integer not null references nhl_teams(id),
  away_team_id integer not null references nhl_teams(id),
  home_score smallint not null,
  away_score smallint not null,
  final_state text not null check (final_state in ('REG', 'OT', 'SO', 'TIE')),
  ot_periods smallint not null default 0,
  home_sog smallint,
  away_sog smallint,
  venue_name text,
  venue_city text,
  -- Data-quality tier (spec section 4) and the audit facts behind it.
  tier text check (tier in ('A+', 'A', 'B', 'C', 'D')),
  goals_with_time smallint,
  goals_match_final boolean,
  has_strength boolean,                 -- real PP/SH flags (not the feed's 'ev' default)
  has_situation_codes boolean,          -- on-ice counts on every event (2009-10 on)
  has_shot_events boolean,
  loaded_at timestamptz not null default now()
);
create index nhl_games_season_idx on nhl_games (season);
create index nhl_games_home_idx on nhl_games (home_team_id, game_date);
create index nhl_games_away_idx on nhl_games (away_team_id, game_date);

create table nhl_goal_events (
  game_id integer not null references nhl_games(id) on delete cascade,
  event_id integer not null,            -- the feed's event id (or a synthetic one for summary-only goals)
  period smallint not null,
  period_type text not null check (period_type in ('REG', 'OT')),
  time_in_period_sec smallint not null,
  time_elapsed_sec integer not null,    -- from opening faceoff, 20-minute periods
  team_id integer not null,
  scorer_id integer,
  assist1_id integer,
  assist2_id integer,
  strength text check (strength in ('EV', 'PP', 'SH', 'PS')),
  empty_net boolean,                    -- null = unknown for that era
  situation_code text,
  score_before_home smallint not null,
  score_before_away smallint not null,
  primary key (game_id, event_id)
);
create index nhl_goal_events_scorer_idx on nhl_goal_events (scorer_id);

create table nhl_penalty_events (
  game_id integer not null references nhl_games(id) on delete cascade,
  event_id integer not null,
  period smallint not null,
  period_type text not null,
  time_in_period_sec smallint not null,
  time_elapsed_sec integer not null,
  team_id integer,
  player_id integer,                    -- committed by
  drawn_by_id integer,
  served_by_id integer,
  minutes smallint,
  type_code text,                       -- MIN, MAJ, MIS, GAM, MAT, PS, BEN
  infraction text,                      -- the feed's descKey, e.g. 'fighting'
  situation_code text,
  primary key (game_id, event_id)
);

create table nhl_period_scores (
  game_id integer not null references nhl_games(id) on delete cascade,
  period smallint not null,
  period_type text not null,
  home_goals smallint not null,
  away_goals smallint not null,
  home_shots smallint,                  -- from shot events; null before they exist
  away_shots smallint,
  primary key (game_id, period)
);

-- Curated fame for Doppelganger (spec section 7). Every row is checked
-- against nhl_games (date, teams, score) before it's trusted.
create table iconic_games (
  game_id integer primary key references nhl_games(id),
  label text not null,
  short_story text not null,
  fame_weight smallint not null check (fame_weight between 1 and 10),
  category text not null,               -- 'mythic' | 'famous' | 'cult' | 'league'
  curated_by text not null,
  verified_at timestamptz
);

-- Not exposed to the Ask box until the history is complete and audited.
revoke all on nhl_franchises, nhl_teams, nhl_players, nhl_games, nhl_goal_events,
  nhl_penalty_events, nhl_period_scores, iconic_games from qa_readonly;
