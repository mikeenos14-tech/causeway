-- Leverage Goals (spec section 8), built by scripts/stats/build-leverage.ts
-- from the win probability model: what each goal did to its team's chance
-- of winning. Kept lean (the database is near its plan limit): scorer,
-- assists, team and time come from nhl_goal_events.

-- One row per goal in a game whose goal list is complete. Chances are the
-- scoring team's expected result (win + half a tie) just before and after.
create table if not exists goal_wpa (
  game_id integer not null,
  event_id integer not null,
  wp_before real not null,
  wp_after real not null,
  stakes real,               -- playoffs: P(series | win game) - P(series | lose game); null in the regular season and unscorable series
  primary key (game_id, event_id),
  foreign key (game_id, event_id) references nhl_goal_events (game_id, event_id) on delete cascade
);

-- Per game, from the home side: pregame chance, final result, the goals'
-- total, and the clock's share (drift), so goals + drift = final - pregame
-- can be checked for every game.
create table if not exists leverage_games (
  game_id integer primary key references nhl_games (id) on delete cascade,
  pregame real not null,
  final real not null,
  goal_wpa real not null,
  drift real not null,
  stakes real,
  series_format text,        -- 'best-of-7' etc., 'total-goals' (no stakes), null in the regular season
  model_version text not null
);

-- Player totals per season and game type ('regular' / 'playoff').
create table if not exists player_leverage (
  player_id integer not null,
  season text not null,
  game_type text not null,
  goals integer not null,
  lg real not null,           -- sum of goal WPA
  garbage_goals integer not null, -- goals with WPA under 0.02
  assists integer not null,
  assist_lg real not null,    -- 0.5 x WPA as primary assist, 0.25 as secondary
  playoff_lg real,            -- sum of WPA x stakes (playoffs, scorable series only)
  primary key (player_id, season, game_type)
);
create index if not exists player_leverage_season on player_leverage (season, game_type);

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'qa_readonly') then
    revoke all on goal_wpa, leverage_games, player_leverage from qa_readonly;
  end if;
end $$;
