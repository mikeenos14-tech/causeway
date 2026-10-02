-- Ask's player stat views carry game_type and season_id (from 0027), so
-- separating regular season from playoffs needs no join. Found testing the
-- full history: "most shutouts in NHL history" summed playoffs into the
-- regular season (Brodeur 149 instead of 125) because the filter needed a
-- join the model skipped. lib/qa-engine.ts also rejects stat totals that
-- don't name a game_type.
drop view if exists qa.skater_game_stats;
create view qa.skater_game_stats as
  select s.game_id, s.player_id, s.team_id, g.season_id, g.game_type, s.goals, s.assists, s.points, s.shots, s.hits, s.blocked_shots, s.giveaways, s.takeaways,
         s.faceoff_wins, s.faceoff_losses, s.penalty_minutes, s.plus_minus, s.pp_goals, s.sh_goals, s.gw_goals, s.toi_seconds
  from public.skater_game_stats s join public.games g on g.id = s.game_id
  union all
  select s.game_id, s.player_id, s.team_id::int, g.season, g.game_type, s.goals, s.assists, (s.goals + s.assists)::smallint, s.sog, null, null, null, null, null, null,
         s.pim, s.plus_minus, null, null, null, null
  from public.nhl_skater_games s join public.nhl_games g on g.id = s.game_id
  where s.played and g.season < '20072008';

drop view if exists qa.goalie_game_stats;
create view qa.goalie_game_stats as
  select s.game_id, s.player_id, s.team_id, g.season_id, g.game_type, s.decision, s.shots_against, s.saves, s.goals_against, s.save_pct, s.toi_seconds, s.shutout
  from public.goalie_game_stats s join public.games g on g.id = s.game_id
  union all
  select x.game_id, x.player_id, x.team_id, g.season, g.game_type, x.decision, x.shots_against, x.saves, x.goals_against,
         case when x.shots_against > 0 then round(x.saves::numeric / x.shots_against, 3) end,
         x.toi_sec,
         ((case when x.team_id = g.home_team_id then g.away_score else g.home_score end)
            - (case when g.final_state = 'SO' and (case when x.team_id = g.home_team_id then g.away_score > g.home_score else g.home_score > g.away_score end) then 1 else 0 end) = 0
          and not exists (select 1 from public.nhl_goalie_games o where o.game_id = x.game_id and o.team_id = x.team_id and o.player_id <> x.player_id and coalesce(o.toi_sec, 1) > 0))
  from public.nhl_goalie_games x join public.nhl_games g on g.id = x.game_id
  where g.season < '20072008' and coalesce(x.toi_sec, 1) > 0;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'qa_readonly') then
    grant select on qa.skater_game_stats, qa.goalie_game_stats to qa_readonly;
  end if;
end $$;
