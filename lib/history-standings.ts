import { pool } from "./db";

// Final standings for any past season, from the NHL's official standings
// (nhl_standings, its last regular-season day). The audit reconciles every
// team-season against our game-by-game data: 1,774 of 1,774 match exactly
// (games, W, L, OTL, T, GF, GA), checked 2026-10-02.
//
// Grouped the way that season's league was: by division, or by conference,
// or one league table in the years with neither (1917-26, 1938-67).

// 2020-21's realigned divisions carried sponsors' names in the feed.
const SPONSOR_DIVISIONS: Record<string, string> = { "Discover Central": "Central", "Honda West": "West", "MassMutual East": "East", "Scotia North": "North" };

export type HistStandingRow = {
  teamId: number;
  code: string;
  name: string;
  gp: number;
  w: number;
  l: number;
  otl: number;
  t: number;
  pts: number;
  gf: number | null;
  ga: number | null;
  group: string; // division, conference, or "League"
  groupParent: string | null; // the division's conference, when there is one
  rank: number; // within the group, as the NHL ordered it
  madePlayoffs: boolean;
};

export async function getHistoricalStandingsSeasons(): Promise<string[]> {
  const { rows } = await pool.query(`select distinct season from nhl_standings order by season desc`);
  return rows.map((r) => r.season as string);
}

export async function getHistoricalStandings(seasonId: string): Promise<{ asOf: string; rows: HistStandingRow[] } | null> {
  const { rows } = await pool.query(
    `with last_day as (
       select max(g.game_date) as d from nhl_games g where g.season = $1 and g.game_type = 'regular'
     ),
     playoff_teams as (
       select distinct unnest(array[home_team_id, away_team_id]) as team_id from nhl_games where season = $1 and game_type = 'playoff'
     )
     select s.team_id, t.tri_code, t.full_name, s.games_played, s.wins, s.losses, s.ot_losses, s.ties, s.points,
            s.goals_for, s.goals_against, s.division, s.conference, s.division_rank, s.conference_rank, s.league_rank,
            (p.team_id is not null) as made_playoffs, s.date::text as as_of
     from nhl_standings s
     join last_day d on s.date = d.d
     join nhl_teams t on t.id = s.team_id
     left join playoff_teams p on p.team_id = s.team_id
     where s.season = $1`,
    [seasonId],
  );
  if (rows.length === 0) return null;
  const out: HistStandingRow[] = rows.map((r) => {
    const group = SPONSOR_DIVISIONS[r.division] ?? r.division ?? r.conference ?? "League";
    return {
      teamId: Number(r.team_id),
      code: r.tri_code,
      name: r.full_name,
      gp: r.games_played,
      w: r.wins,
      l: r.losses,
      otl: r.ot_losses,
      t: r.ties,
      pts: r.points,
      gf: r.goals_for,
      ga: r.goals_against,
      group,
      groupParent: r.division ? r.conference : null,
      // The NHL's own order within the group; points as a fallback.
      rank: (r.division ? r.division_rank : r.conference ? r.conference_rank : r.league_rank) ?? 999,
      madePlayoffs: r.made_playoffs,
    };
  });
  out.sort((a, b) => (a.groupParent ?? "").localeCompare(b.groupParent ?? "") || a.group.localeCompare(b.group) || a.rank - b.rank || b.pts - a.pts);
  return { asOf: rows[0].as_of, rows: out };
}
