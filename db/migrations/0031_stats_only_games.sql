-- Games whose player stats count though the game itself doesn't: Game 4 of
-- the 1988 Final (Edmonton at Boston Garden, 1988-05-24), suspended at 3-3
-- in the second period when the Garden lost power. The NHL counts its
-- player stats (a game played for everyone, Glen Wesley's two goals, a tie
-- for Moog and Fuhr) but not the game: the series was replayed in Edmonton
-- and the record book has it as a sweep. The NHL keeps it as game
-- 1987030999, outside its schedule and with no box score; the per-game
-- stats come from its stats service (scripts/stats/load-stats-only-games.ts).
--
-- Kept out of nhl_games on purpose, so nothing built on results (Elo, win
-- probability, series, standings, Ask's games) ever sees it. Its player
-- rows go in the usual player tables, which every result reader joins to
-- nhl_games (dropping them); player totals read nhl_stat_games instead.
create table if not exists nhl_stats_only_games (
  id integer primary key,
  season text not null,
  game_type text not null check (game_type in ('regular', 'playoff')),
  game_date date not null,
  home_team_id integer not null references nhl_teams(id),
  away_team_id integer not null references nhl_teams(id),
  home_score smallint not null,
  away_score smallint not null,
  note text not null
);

-- Its goalie rows can't reference nhl_games. Nothing relied on the cascade
-- (every loader deletes goalie rows itself before reloading a game).
alter table nhl_goalie_games drop constraint if exists nhl_goalie_games_game_id_fkey;

-- Every game whose player stats count: for player totals only.
create or replace view nhl_stat_games as
  select id, season, game_type, game_date, home_team_id, away_team_id, home_score, away_score, final_state from nhl_games
  union all
  select id, season, game_type, game_date, home_team_id, away_team_id, home_score, away_score, 'TIE' from nhl_stats_only_games;

-- Ask's player stat views (0029, 0030) on the same games.
create or replace view qa.skater_game_stats as
  select s.game_id, s.player_id, s.team_id, g.season_id, g.game_type, s.goals, s.assists, s.points, s.shots, s.hits, s.blocked_shots, s.giveaways, s.takeaways,
         s.faceoff_wins, s.faceoff_losses, s.penalty_minutes, s.plus_minus, s.pp_goals, s.sh_goals, s.gw_goals, s.toi_seconds
  from public.skater_game_stats s join public.games g on g.id = s.game_id
  union all
  select s.game_id, s.player_id, s.team_id::int, g.season, g.game_type, s.goals, s.assists, (s.goals + s.assists)::smallint, s.sog, null, null, null, null, null, null,
         s.pim, s.plus_minus, null, null, null, null
  from public.nhl_skater_games s join public.nhl_stat_games g on g.id = s.game_id
  where s.played and g.season < '20072008';

create or replace view qa.goalie_game_stats as
  select s.game_id, s.player_id, s.team_id, g.season_id, g.game_type, s.decision, s.shots_against, s.saves, s.goals_against, s.save_pct, s.toi_seconds, s.shutout
  from public.goalie_game_stats s join public.games g on g.id = s.game_id
  union all
  select x.game_id, x.player_id, x.team_id, g.season, g.game_type, x.decision, x.shots_against, x.saves, x.goals_against,
         case when x.shots_against > 0 then round(x.saves::numeric / x.shots_against, 3) end,
         x.toi_sec,
         ((case when x.team_id = g.home_team_id then g.away_score else g.home_score end)
            - (case when g.final_state = 'SO' and (case when x.team_id = g.home_team_id then g.away_score > g.home_score else g.home_score > g.away_score end) then 1 else 0 end) = 0
          and coalesce(x.toi_sec, 1) > 0
          and not exists (select 1 from public.nhl_goalie_games o where o.game_id = x.game_id and o.team_id = x.team_id and o.player_id <> x.player_id and coalesce(o.toi_sec, 1) > 0))
  from public.nhl_goalie_games x join public.nhl_stat_games g on g.id = x.game_id
  where g.season < '20072008' and (coalesce(x.toi_sec, 1) > 0 or x.decision is not null);

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'qa_readonly') then
    revoke all on nhl_stats_only_games, nhl_stat_games from qa_readonly;
  end if;
end $$;
