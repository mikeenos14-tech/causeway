import { pool } from "./db";

export type LeagueTeamStats = {
  teamId: number;
  abbrev: string;
  name: string;
  gamesPlayed: number;
  goalsFor: number;
  goalsAgainst: number;
  goalsForPerGame: number;
  goalsAgainstPerGame: number;
  points: number | null;
  pointsPct: number | null;
  ppPct: number | null;
  pkPct: number | null;
  faceoffWinPct: number | null;
  specialTeamsCoverage: number; // fraction of this team's games with team_game_stats loaded — lets the UI hide PP/PK until it's trustworthy
  xgForPerGame: number | null;
  xgAgainstPerGame: number | null;
  xgCoverage: number; // fraction of this team's games with a MoneyPuck xG row loaded
};

// The season a league-wide comparison should rank against — the same
// "whatever's actually loaded" pattern as the rest of the site, no
// hardcoded year, with one condition: a ranking is only a claim about the
// whole league once every active team has played. On a season's first
// nights, "the newest season with any games" would rank a team "1st of 10"
// under a header saying "vs. all 32 NHL teams" (every team has a game by
// the fourth night of 2026-27). Until then this returns last season's
// final comparison plus the new season's progress, so the page can say why.
export async function getLeagueComparisonSeason(): Promise<{
  seasonId: string | null;
  pending: { seasonId: string; teamsPlayed: number; teamsTotal: number } | null;
}> {
  const { rows } = await pool.query(
    `select g.season_id, count(distinct t.id)::int as teams_played,
            (select count(*)::int from teams where is_active) as teams_total
     from games g
     join teams t on t.id in (g.home_team_id, g.away_team_id) and t.is_active
     where g.game_type = 'regular'
     group by g.season_id
     order by g.season_id desc
     limit 2`,
  );
  if (rows.length === 0) return { seasonId: null, pending: null };
  const [newest, previous] = rows;
  if (newest.teams_played >= newest.teams_total || !previous) return { seasonId: String(newest.season_id), pending: null };
  return {
    seasonId: String(previous.season_id),
    pending: { seasonId: String(newest.season_id), teamsPlayed: newest.teams_played, teamsTotal: newest.teams_total },
  };
}

// One row per active team for the given season: goals for/against (from
// games, always available), standings points/points%, and special-teams
// aggregates (from team_game_stats, which fills in progressively via its
// own backfill — specialTeamsCoverage tells the caller how much of this
// team's season that average actually represents, so a page can hide a
// PP%/PK% comparison until it's trustworthy instead of showing a
// misleadingly partial one).
export async function getLeagueTeamStats(seasonId: string): Promise<LeagueTeamStats[]> {
  const { rows } = await pool.query(
    `with team_games as (
       select t.id as team_id, t.abbrev, t.name,
              count(*) as games_played,
              sum(case when g.home_team_id = t.id then g.home_score else g.away_score end) as goals_for,
              sum(case when g.home_team_id = t.id then g.away_score else g.home_score end) as goals_against
       from teams t
       join games g on (g.home_team_id = t.id or g.away_team_id = t.id)
       where g.season_id = $1 and g.game_type = 'regular' and t.is_active = true
       group by t.id, t.abbrev, t.name
     ),
     special_teams as (
       select tgs.team_id,
              count(*) as games_with_stats,
              sum(tgs.pp_goals) as pp_goals,
              sum(tgs.pp_opportunities) as pp_opportunities,
              sum(tgs.pk_goals_against) as pk_goals_against,
              sum(tgs.pk_times_shorthanded) as pk_times_shorthanded,
              avg(tgs.faceoff_win_pct) as faceoff_win_pct
       from team_game_stats tgs
       join games g on g.id = tgs.game_id
       where g.season_id = $1 and g.game_type = 'regular'
       group by tgs.team_id
     ),
     xg as (
       select tgs.team_id,
              count(*) as games_with_xg,
              sum(tgs.xg_for) as xg_for,
              sum(tgs.xg_against) as xg_against
       from team_game_stats tgs
       join games g on g.id = tgs.game_id
       where g.season_id = $1 and g.game_type = 'regular' and tgs.xg_for is not null
       group by tgs.team_id
     ),
     latest_standings as (
       select distinct on (team_id) team_id, points, points_pct
       from standings_snapshots
       where season_id = $1
       order by team_id, snapshot_date desc
     )
     select tg.team_id, tg.abbrev, tg.name, tg.games_played, tg.goals_for, tg.goals_against,
            ls.points, ls.points_pct,
            st.games_with_stats, st.pp_goals, st.pp_opportunities, st.pk_goals_against, st.pk_times_shorthanded, st.faceoff_win_pct,
            xg.games_with_xg, xg.xg_for, xg.xg_against
     from team_games tg
     left join latest_standings ls on ls.team_id = tg.team_id
     left join special_teams st on st.team_id = tg.team_id
     left join xg on xg.team_id = tg.team_id
     order by tg.abbrev asc`,
    [seasonId],
  );

  return rows.map((r) => {
    const gamesPlayed = Number(r.games_played);
    const gamesWithStats = Number(r.games_with_stats ?? 0);
    const ppOpportunities = Number(r.pp_opportunities ?? 0);
    const pkTimesShorthanded = Number(r.pk_times_shorthanded ?? 0);
    const gamesWithXg = Number(r.games_with_xg ?? 0);
    return {
      teamId: r.team_id,
      abbrev: r.abbrev,
      name: r.name,
      gamesPlayed,
      goalsFor: Number(r.goals_for),
      goalsAgainst: Number(r.goals_against),
      goalsForPerGame: Number(r.goals_for) / gamesPlayed,
      goalsAgainstPerGame: Number(r.goals_against) / gamesPlayed,
      points: r.points != null ? Number(r.points) : null,
      pointsPct: r.points_pct != null ? Number(r.points_pct) : null,
      ppPct: ppOpportunities > 0 ? Number(r.pp_goals) / ppOpportunities : null,
      pkPct: pkTimesShorthanded > 0 ? 1 - Number(r.pk_goals_against) / pkTimesShorthanded : null,
      faceoffWinPct: r.faceoff_win_pct != null ? Number(r.faceoff_win_pct) : null,
      specialTeamsCoverage: gamesPlayed > 0 ? gamesWithStats / gamesPlayed : 0,
      xgForPerGame: gamesWithXg > 0 ? Number(r.xg_for) / gamesWithXg : null,
      xgAgainstPerGame: gamesWithXg > 0 ? Number(r.xg_against) / gamesWithXg : null,
      xgCoverage: gamesPlayed > 0 ? gamesWithXg / gamesPlayed : 0,
    };
  });
}

// bestTeam / worstTeam: who holds each end of the range, so the page can
// name and link them.
export type LeagueRank = { value: number; rank: number; outOf: number; min: number; max: number; leagueAvg: number; bestTeam: string; worstTeam: string };

// Rank + the full league's min/max/avg for one metric — everything a
// percentile bar needs to draw itself. `higherIsBetter` flips the rank
// direction (e.g. goals against: lower is the good end of the range).
export function rankTeam(
  teams: LeagueTeamStats[],
  teamAbbrev: string,
  metric: (t: LeagueTeamStats) => number | null,
  higherIsBetter: boolean,
): LeagueRank | null {
  const withValues = teams.map((t) => ({ abbrev: t.abbrev, value: metric(t) })).filter((t): t is { abbrev: string; value: number } => t.value != null);
  if (withValues.length === 0) return null;
  const target = withValues.find((t) => t.abbrev === teamAbbrev);
  if (!target) return null;

  const sorted = [...withValues].sort((a, b) => (higherIsBetter ? b.value - a.value : a.value - b.value));
  const rank = sorted.findIndex((t) => t.abbrev === teamAbbrev) + 1;
  const values = withValues.map((t) => t.value);
  const leagueAvg = values.reduce((a, b) => a + b, 0) / values.length;

  return {
    value: target.value,
    rank,
    outOf: withValues.length,
    min: Math.min(...values),
    max: Math.max(...values),
    leagueAvg,
    bestTeam: sorted[0].abbrev,
    worstTeam: sorted[sorted.length - 1].abbrev,
  };
}
