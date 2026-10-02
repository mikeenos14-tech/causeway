import { pool } from "./db";

export async function getPlayer(playerId: number) {
  const { rows } = await pool.query(
    `select id, full_name, position, shoots_catches, birth_date, birth_country, height_cm, weight_kg
     from players where id = $1`,
    [playerId],
  );
  return rows[0] ?? null;
}

// Scoped by game type: the NHL's career totals (and every milestone) are
// regular season only. These once summed every game on file, so a career
// card read 929 GP / 1027 P for Pastrnak while the season table right
// below it summed to 833 / 933 — playoffs silently blended in.
export type GameType = "regular" | "playoff";

// Full careers: the NHL's history tables before 2007-08 (nhl_skater_games
// rows marked played, nhl_goalie_games) joined to the site's own tables
// from 2007-08 on, which carry more (ice time, hits). Checked against the
// NHL's official career totals by scripts/qa/check-player-careers.ts.
// Before 2007-08 there's no ice time, and plus-minus and shots exist from
// 1959-60; untracked values stay null, never 0.
const HISTORY_UNTIL = "20072008"; // history tables for seasons before this; site tables from it

export async function getSkaterCareerTotals(playerId: number, gameType: GameType = "regular") {
  const { rows } = await pool.query(
    `select sum(games)::int as games, sum(goals)::int as goals, sum(assists)::int as assists, sum(goals + assists)::int as points
     from (
       select count(*) games, coalesce(sum(s.goals), 0) goals, coalesce(sum(s.assists), 0) assists
       from nhl_skater_games s join nhl_games g on g.id = s.game_id
       where s.player_id = $1 and g.game_type = $2 and s.played and g.season < $3
       union all
       select count(*), coalesce(sum(s.goals), 0), coalesce(sum(s.assists), 0)
       from skater_game_stats s join games g on g.id = s.game_id
       where s.player_id = $1 and g.game_type = $2
     ) t`,
    [playerId, gameType, HISTORY_UNTIL],
  );
  return rows[0];
}

// Shutouts before 2007-08, from the game records: the goalie was his
// team's only goalie that night and the opponent scored nothing in
// regulation or overtime (a shootout winner doesn't count against him; an
// empty-net goal does), the NHL's rule.
const historyGoalie = (gameType: string, season: string) => `
  select x.game_id, g.season, x.team_id, x.decision, x.shots_against, x.saves,
         ((case when x.team_id = g.home_team_id then g.away_score else g.home_score end)
            - (case when g.final_state = 'SO' and (case when x.team_id = g.home_team_id then g.away_score > g.home_score else g.home_score > g.away_score end) then 1 else 0 end) = 0
          and not exists (select 1 from nhl_goalie_games o where o.game_id = x.game_id and o.team_id = x.team_id and o.player_id <> x.player_id and coalesce(o.toi_sec, 1) > 0)) as shutout
  from nhl_goalie_games x join nhl_games g on g.id = x.game_id
  where x.player_id = $1 and g.game_type = ${gameType} and g.season < ${season} and coalesce(x.toi_sec, 1) > 0`;

export async function getGoalieCareerTotals(playerId: number, gameType: GameType = "regular") {
  const { rows } = await pool.query(
    `select count(*)::int as games,
            count(*) filter (where decision = 'W')::int as wins,
            count(*) filter (where decision = 'L')::int as losses,
            count(*) filter (where decision = 'OTL')::int as otl,
            count(*) filter (where decision = 'T')::int as ties,
            count(*) filter (where shutout)::int as shutouts,
            case when sum(shots_against) > 0 then round(sum(saves)::numeric / sum(shots_against), 3) else null end as save_pct
     from (
       select decision, shutout, shots_against, saves from (${historyGoalie("$2", "$3")}) h
       union all
       select s.decision, s.shutout, s.shots_against, s.saves
       from goalie_game_stats s join games g on g.id = s.game_id
       where s.player_id = $1 and g.game_type = $2
     ) t`,
    [playerId, gameType, HISTORY_UNTIL],
  );
  return rows[0];
}

// Grouped by (season, team) rather than just season — a player traded
// mid-season gets one row per team, matching how every real hockey
// stats site shows a split season, instead of silently merging two
// different teams' games into one misleading row. team_active: today's
// clubs get a link; a retired code (HFD, QUE) doesn't.
export async function getSkaterSeasonSplits(playerId: number) {
  const { rows } = await pool.query(
    `select h.season as season_id, t.tri_code as team_abbrev, exists (select 1 from teams a where a.abbrev = t.tri_code and a.is_active) as team_active,
            count(*)::int as games, sum(h.goals)::int as goals, sum(h.assists)::int as assists, sum(h.goals + h.assists)::int as points,
            case when count(h.plus_minus) = count(*) then sum(h.plus_minus)::int end as plus_minus, sum(h.pim)::int as pim,
            case when count(h.sog) = count(*) then sum(h.sog)::int end as shots, null::int as toi_seconds_total
     from (select g.season, s.team_id, s.goals, s.assists, s.plus_minus, s.pim, s.sog
           from nhl_skater_games s join nhl_games g on g.id = s.game_id
           where s.player_id = $1 and g.game_type = 'regular' and s.played and g.season < $2) h
     join nhl_teams t on t.id = h.team_id
     group by h.season, t.tri_code
     union all
     select g.season_id, t.abbrev, t.is_active,
            count(*)::int, sum(sgs.goals)::int, sum(sgs.assists)::int, sum(sgs.points)::int,
            sum(sgs.plus_minus)::int, sum(sgs.penalty_minutes)::int, sum(sgs.shots)::int, sum(sgs.toi_seconds)::int
     from skater_game_stats sgs
     join games g on g.id = sgs.game_id
     join teams t on t.id = sgs.team_id
     where sgs.player_id = $1 and g.game_type = 'regular'
     group by g.season_id, t.abbrev, t.is_active
     order by 1 asc, 2 asc`,
    [playerId, HISTORY_UNTIL],
  );
  return rows.map((r) => ({
    ...r,
    toiSecondsPerGame: r.toi_seconds_total != null && r.games > 0 ? Math.round(r.toi_seconds_total / r.games) : null,
    shootingPct: r.shots != null && r.shots > 0 ? r.goals / r.shots : null,
  }));
}

export async function getGoalieSeasonSplits(playerId: number) {
  const { rows } = await pool.query(
    `select h.season as season_id, t.tri_code as team_abbrev, exists (select 1 from teams a where a.abbrev = t.tri_code and a.is_active) as team_active,
            count(*)::int as games,
            count(*) filter (where h.decision = 'W')::int as wins,
            count(*) filter (where h.decision = 'L')::int as losses,
            count(*) filter (where h.decision = 'OTL')::int as otl,
            count(*) filter (where h.decision = 'T')::int as ties,
            count(*) filter (where h.shutout)::int as shutouts,
            sum(h.saves)::int as saves, sum(h.shots_against)::int as shots_against
     from (${historyGoalie("'regular'", "$2")}) h
     join nhl_teams t on t.id = h.team_id
     group by h.season, t.tri_code
     union all
     select g.season_id, t.abbrev, t.is_active,
            count(*)::int,
            sum(case when ggs.decision='W' then 1 else 0 end)::int,
            sum(case when ggs.decision='L' then 1 else 0 end)::int,
            sum(case when ggs.decision='OTL' then 1 else 0 end)::int,
            0,
            sum(ggs.shutout::int)::int,
            sum(ggs.saves)::int, sum(ggs.shots_against)::int
     from goalie_game_stats ggs
     join games g on g.id = ggs.game_id
     join teams t on t.id = ggs.team_id
     where ggs.player_id = $1 and g.game_type = 'regular'
     group by g.season_id, t.abbrev, t.is_active
     order by 1 asc, 2 asc`,
    [playerId, HISTORY_UNTIL],
  );
  return rows.map((r) => ({
    ...r,
    savePct: Number(r.shots_against) > 0 ? Number(r.saves) / Number(r.shots_against) : null,
  }));
}

export async function getRecentGameLog(playerId: number, isGoalie: boolean, limit = 10) {
  if (isGoalie) {
    const { rows } = await pool.query(
      `select g.id as game_id, g.game_date, t.abbrev as team_abbrev,
              (g.home_team_id = s.team_id) as is_home,
              case when g.home_team_id = s.team_id then at.abbrev else ht.abbrev end as opp_abbrev,
              s.decision, s.saves, s.shots_against, s.goals_against
       from goalie_game_stats s
       join games g on g.id = s.game_id
       join teams t on t.id = s.team_id
       join teams ht on ht.id = g.home_team_id
       join teams at on at.id = g.away_team_id
       where s.player_id = $1
       order by g.game_date desc
       limit $2`,
      [playerId, limit],
    );
    return rows;
  }
  const { rows } = await pool.query(
    `select g.id as game_id, g.game_date, t.abbrev as team_abbrev,
            (g.home_team_id = s.team_id) as is_home,
            case when g.home_team_id = s.team_id then at.abbrev else ht.abbrev end as opp_abbrev,
            s.goals, s.assists, s.points, s.shots, s.toi_seconds
     from skater_game_stats s
     join games g on g.id = s.game_id
     join teams t on t.id = s.team_id
     join teams ht on ht.id = g.home_team_id
     join teams at on at.id = g.away_team_id
     where s.player_id = $1
     order by g.game_date desc
     limit $2`,
    [playerId, limit],
  );
  return rows;
}
