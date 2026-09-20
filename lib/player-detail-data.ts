import { pool } from "./db";

export async function getPlayer(playerId: number) {
  const { rows } = await pool.query(
    `select id, full_name, position, shoots_catches, birth_date, birth_country, height_cm, weight_kg
     from players where id = $1`,
    [playerId],
  );
  return rows[0] ?? null;
}

export async function getSkaterCareerTotals(playerId: number) {
  const { rows } = await pool.query(
    `select count(*) as games, coalesce(sum(goals),0) as goals, coalesce(sum(assists),0) as assists,
            coalesce(sum(goals+assists),0) as points
     from skater_game_stats where player_id = $1`,
    [playerId],
  );
  return rows[0];
}

export async function getGoalieCareerTotals(playerId: number) {
  const { rows } = await pool.query(
    `select count(*) as games,
            coalesce(sum(case when decision='W' then 1 else 0 end),0) as wins,
            coalesce(sum(case when decision='L' then 1 else 0 end),0) as losses,
            coalesce(sum(case when decision='OTL' then 1 else 0 end),0) as otl,
            coalesce(sum(shutout::int),0) as shutouts,
            case when sum(shots_against) > 0
              then round(sum(saves)::numeric / sum(shots_against), 3)
              else null end as save_pct
     from goalie_game_stats where player_id = $1`,
    [playerId],
  );
  return rows[0];
}

// Grouped by (season, team) rather than just season — a player traded
// mid-season gets one row per team, matching how every real hockey
// stats site shows a split season, instead of silently merging two
// different teams' games into one misleading row.
export async function getSkaterSeasonSplits(playerId: number) {
  const { rows } = await pool.query(
    `select g.season_id, t.abbrev as team_abbrev,
            count(*)::int as games,
            sum(sgs.goals)::int as goals, sum(sgs.assists)::int as assists, sum(sgs.points)::int as points,
            sum(sgs.plus_minus)::int as plus_minus, sum(sgs.penalty_minutes)::int as pim, sum(sgs.shots)::int as shots,
            sum(sgs.toi_seconds)::int as toi_seconds_total
     from skater_game_stats sgs
     join games g on g.id = sgs.game_id
     join teams t on t.id = sgs.team_id
     where sgs.player_id = $1 and g.game_type = 'regular'
     group by g.season_id, t.abbrev
     order by g.season_id asc, t.abbrev asc`,
    [playerId],
  );
  return rows.map((r) => ({
    ...r,
    toiSecondsPerGame: r.games > 0 ? Math.round(r.toi_seconds_total / r.games) : 0,
    shootingPct: r.shots > 0 ? r.goals / r.shots : null,
  }));
}

export async function getGoalieSeasonSplits(playerId: number) {
  const { rows } = await pool.query(
    `select g.season_id, t.abbrev as team_abbrev,
            count(*)::int as games,
            sum(case when ggs.decision='W' then 1 else 0 end)::int as wins,
            sum(case when ggs.decision='L' then 1 else 0 end)::int as losses,
            sum(case when ggs.decision='OTL' then 1 else 0 end)::int as otl,
            sum(ggs.shutout::int)::int as shutouts,
            sum(ggs.saves)::int as saves, sum(ggs.shots_against)::int as shots_against
     from goalie_game_stats ggs
     join games g on g.id = ggs.game_id
     join teams t on t.id = ggs.team_id
     where ggs.player_id = $1 and g.game_type = 'regular'
     group by g.season_id, t.abbrev
     order by g.season_id asc, t.abbrev asc`,
    [playerId],
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
