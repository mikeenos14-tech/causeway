-- Per-player box scores for games before 2007-08 (the site's own tables
-- cover 2007-08 on), from the NHL's boxscore feed, loaded by
-- scripts/stats/load-nhl-skaters.ts. Compact on purpose (the database plan
-- caps at 1 GB). sog and plus_minus are null where the era didn't track
-- them (before 1959-60): the feed sends untracked stats as 0, never shown.
create table if not exists nhl_skater_games (
  game_id integer not null,
  player_id integer not null,
  team_id smallint not null,
  position char(1),
  goals smallint not null,
  assists smallint not null,
  pim smallint not null,
  sog smallint,
  plus_minus smallint,
  primary key (game_id, player_id)
);
create index if not exists nhl_skater_games_player on nhl_skater_games (player_id);

-- One row per game: did its box score pass every check against the goal,
-- assist and penalty records? Game pages show a box score only when ok.
create table if not exists nhl_box_checks (
  game_id integer primary key,
  ok boolean not null,
  sog_ok boolean not null,  -- shots tracked and adding up to the team's total
  reason text
);
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'qa_readonly') then
    revoke all on nhl_skater_games from qa_readonly;
    revoke all on nhl_box_checks from qa_readonly;
  end if;
end $$;
