-- Ask (lib/qa-engine.ts) gets the full history, 1917-18 on.
--
-- A `qa` schema of views with the same names and columns Ask already uses
-- (games, teams, players, skater_game_stats, goalie_game_stats, seasons,
-- playoff_series, standings_snapshots), each the NHL history tables
-- before 2007-08 joined to the site's own tables from 2007-08 on, plus
-- goal_events (every goal since 1917). Ask queries with qa first on its
-- search_path, and (0028) loses direct access to the 2007-on base tables,
-- so there's one source per name and no way to query only half the
-- history by mistake.
-- Columns a season didn't record are NULL, never 0 (Ask's prompt lists
-- which).

create schema if not exists qa;

-- Teams: today's clubs plus every historical team id (Maroons, Nordiques).
create or replace view qa.teams as
  select id, franchise_id, name, abbrev, city, conference, division, is_active from public.teams
  union all
  select n.id, n.franchise_id, n.full_name, n.tri_code, null, null, null, false
  from public.nhl_teams n where not exists (select 1 from public.teams t where t.id = n.id);

-- Players: the site's (with bios) plus everyone else since 1917 (name and
-- position only).
create or replace view qa.players as
  select id, full_name, position, shoots_catches, birth_date, birth_country, height_cm, weight_kg from public.players
  union all
  select n.id, n.full_name, n.position, null::char(1), null::date, null, null::smallint, null::smallint
  from public.nhl_players n where not exists (select 1 from public.players p where p.id = n.id);

-- Playoff series: the site's from 2007-08; before that, derived from the
-- game ids (season, round and series digits). The winner has more wins,
-- or in the early two-game total-goals series, more goals. Synthetic ids
-- (season * 100 + round * 10 + series) can't collide with the site's.
create or replace view qa.playoff_series as
  select id, season_id, round, team_a_id, team_b_id, winner_team_id, games_played, null::text as format from public.playoff_series
  union all
  select (season::bigint * 100 + rnd * 10 + ser), season, rnd::smallint, a, b,
         case when aw > bw or (aw = bw and ag > bg) then a else b end,
         n::smallint,
         case when season < '19371938' and n = 2 and not (rnd = max_round and season in ('19281929', '19291930')) then 'total goals' end
  from (
    select g.season, (g.id / 100) % 10 rnd, (g.id / 10) % 10 ser, count(*) n,
           min(g.home_team_id) filter (where g.id = f.first_id) a, min(g.away_team_id) filter (where g.id = f.first_id) b,
           (select max((x.id / 100) % 10) from public.nhl_games x where x.season = g.season and x.game_type = 'playoff') max_round,
           sum(case when g.home_team_id = f.a0 then (g.home_score > g.away_score)::int else (g.away_score > g.home_score)::int end) aw,
           sum(case when g.home_team_id = f.a0 then (g.home_score < g.away_score)::int else (g.away_score < g.home_score)::int end) bw,
           sum(case when g.home_team_id = f.a0 then g.home_score else g.away_score end) ag,
           sum(case when g.home_team_id = f.a0 then g.away_score else g.home_score end) bg
    from public.nhl_games g
    join (select season, (id / 100) % 10 r, (id / 10) % 10 s, min(id) first_id,
                 (select home_team_id from public.nhl_games y where y.id = min(z.id)) a0
          from public.nhl_games z where game_type = 'playoff' and season < '20072008' group by 1, 2, 3) f
      on f.season = g.season and f.r = (g.id / 100) % 10 and f.s = (g.id / 10) % 10
    where g.game_type = 'playoff' and g.season < '20072008' and (g.id / 100) % 10 > 0
    group by 1, 2, 3
  ) s;

-- Games: game_end_type adds 'tie' (ties ended in 2004-05). ot_loser_point
-- before 2007-08: overtime and shootout losers got a point from 1999-2000,
-- except after an empty-net goal in overtime.
create or replace view qa.games as
  select id, season_id, game_date, game_datetime, game_type, game_end_type, ot_loser_point, series_id, series_game_number,
         home_team_id, away_team_id, home_score, away_score, venue
  from public.games
  union all
  select g.id, g.season, g.game_date, g.start_time_utc,
         g.game_type,
         case g.final_state when 'REG' then 'regulation' when 'OT' then 'overtime' when 'SO' then 'shootout' else 'tie' end,
         g.final_state in ('OT', 'SO') and g.season >= '19992000'
           and not exists (select 1 from public.nhl_goal_events e where e.game_id = g.id and e.period_type = 'OT' and e.empty_net),
         case when g.game_type = 'playoff' then g.season::bigint * 100 + ((g.id / 100) % 10) * 10 + (g.id / 10) % 10 end,
         case when g.game_type = 'playoff' then (g.id % 10)::smallint end,
         g.home_team_id, g.away_team_id, g.home_score, g.away_score, g.venue_name
  from public.nhl_games g where g.season < '20072008' and g.game_type in ('regular', 'playoff');

create or replace view qa.seasons as
  select id, start_date, end_date from public.seasons
  union all
  select season, min(game_date), max(game_date) from public.nhl_games where season < '20072008' group by season;

-- Skaters before 2007-08: goals, assists, points, penalty minutes; shots
-- and plus-minus from 1959-60 (null before); nothing else was recorded per
-- player. Only rows for players who actually played (old box scores also
-- list dressed players who didn't).
create or replace view qa.skater_game_stats as
  select game_id, player_id, team_id, goals, assists, points, shots, hits, blocked_shots, giveaways, takeaways, faceoff_wins, faceoff_losses,
         penalty_minutes, plus_minus, pp_goals, sh_goals, gw_goals, toi_seconds
  from public.skater_game_stats
  union all
  select s.game_id, s.player_id, s.team_id::int, s.goals, s.assists, (s.goals + s.assists)::smallint, s.sog, null, null, null, null, null, null,
         s.pim, s.plus_minus, null, null, null, null
  from public.nhl_skater_games s join public.nhl_games g on g.id = s.game_id
  where s.played and g.season < '20072008';

-- Goalies before 2007-08: decision includes 'T' (tie); shutout by the
-- NHL's rule (alone in net, no goals against in regulation or overtime;
-- an empty-net goal counts, a shootout winner doesn't).
create or replace view qa.goalie_game_stats as
  select game_id, player_id, team_id, decision, shots_against, saves, goals_against, save_pct, toi_seconds, shutout from public.goalie_game_stats
  union all
  select x.game_id, x.player_id, x.team_id, x.decision, x.shots_against, x.saves, x.goals_against,
         case when x.shots_against > 0 then round(x.saves::numeric / x.shots_against, 3) end,
         x.toi_sec,
         ((case when x.team_id = g.home_team_id then g.away_score else g.home_score end)
            - (case when g.final_state = 'SO' and (case when x.team_id = g.home_team_id then g.away_score > g.home_score else g.home_score > g.away_score end) then 1 else 0 end) = 0
          and not exists (select 1 from public.nhl_goalie_games o where o.game_id = x.game_id and o.team_id = x.team_id and o.player_id <> x.player_id and coalesce(o.toi_sec, 1) > 0))
  from public.nhl_goalie_games x join public.nhl_games g on g.id = x.game_id
  where g.season < '20072008' and coalesce(x.toi_sec, 1) > 0;

-- Standings: the site's snapshots from 2007-08; NHL daily standings before.
create or replace view qa.standings_snapshots as
  select id, team_id, season_id, snapshot_date, division, conference, games_played, wins, losses, ot_losses, null::smallint as ties, points, points_pct,
         goals_for, goals_against, division_rank, conference_rank, league_rank
  from public.standings_snapshots
  union all
  select null::bigint, team_id, season, date, division, conference, games_played, wins, losses, ot_losses, ties, points,
         round(points::numeric / nullif(games_played * 2, 0), 3), goals_for, goals_against, division_rank, conference_rank, league_rank
  from public.nhl_standings where season < '20072008';

-- Every goal since 1917-18 (all seasons, one source): when, by whom, the
-- score before it. strength (EV/PP/SH/PS) only where the game's records
-- mark it (otherwise null); empty_net known from 2009-10 (earlier: true
-- where recorded, else null).
create or replace view qa.goal_events as
  select e.game_id, e.period, e.period_type, e.time_in_period_sec as time_in_period_seconds, e.time_elapsed_sec as time_elapsed_seconds,
         e.team_id, e.scorer_id, e.assist1_id, e.assist2_id,
         case when g.has_strength then e.strength end as strength, e.empty_net, e.score_before_home, e.score_before_away
  from public.nhl_goal_events e join public.nhl_games g on g.id = e.game_id;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'qa_readonly') then
    grant usage on schema qa to qa_readonly;
    grant select on all tables in schema qa to qa_readonly;
    -- Ask never needs the site's request log, answer cache or migration list.
    revoke all on public.qa_requests, public.qa_answer_cache, public.schema_migrations from qa_readonly;
  end if;
end $$;
-- Ask's code sets search_path = qa, public per query (lib/qa-engine.ts), so
-- the switch ships with the prompt that explains the older data; 0028
-- then locks the role to the qa views once that code is live.
