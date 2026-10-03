-- A goalie sent in only for the shootout has 0:00 of ice time but the
-- NHL's decision and a game played (Kari Lehtonen, 2006-10-26), so he
-- counts as an appearance; he never counts toward a shared net for a
-- shutout, which is about the 65 minutes. Same rule as the site's own
-- tables (scripts/backfill-season.ts) and the player pages. Found
-- 2026-10-03 checking every career against the NHL.
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
  from public.nhl_goalie_games x join public.nhl_games g on g.id = x.game_id
  where g.season < '20072008' and (coalesce(x.toi_sec, 1) > 0 or x.decision is not null);
