import { pool } from "./db";

export async function getLatestStandingsDate() {
  const { rows } = await pool.query(`select max(snapshot_date) as d from standings_snapshots`);
  return rows[0]?.d ?? null;
}

export async function getFullStandings(date: string) {
  const { rows } = await pool.query(
    `select t.abbrev, t.name, ss.division, ss.conference, ss.games_played, ss.wins, ss.losses,
            ss.ot_losses, ss.points, ss.points_pct, ss.division_rank
     from standings_snapshots ss
     join teams t on t.id = ss.team_id
     where ss.snapshot_date = $1
     order by ss.division, ss.division_rank`,
    [date],
  );
  return rows;
}

export type WildCardTeam = {
  abbrev: string;
  name: string;
  division: string;
  games_played: number;
  wins: number;
  losses: number;
  ot_losses: number;
  points: number;
  points_pct: number;
};

export type ConferencePicture = {
  conference: string;
  divisionLeaders: Record<string, WildCardTeam[]>; // top 3 per division, keyed by division name
  wildCard: WildCardTeam[]; // remaining teams, ranked; first 2 are "in"
};

// The real NHL playoff format: top 3 in each division qualify outright: the
// rest of the conference — regardless of division — competes for 2 "wild
// card" spots on points (points_pct as the tiebreak, matching the tiebreak
// standings_snapshots itself is already ranked by). Nothing here is a new
// data source — division_rank, conference, and points were already loaded
// for the plain division tables; this is the same rows regrouped the way
// the actual playoff format groups them, which the division-only view
// never showed.
export async function getConferencePictures(date: string): Promise<ConferencePicture[]> {
  const { rows } = await pool.query(
    `select t.abbrev, t.name, ss.division, ss.conference, ss.games_played, ss.wins, ss.losses,
            ss.ot_losses, ss.points, ss.points_pct, ss.division_rank
     from standings_snapshots ss
     join teams t on t.id = ss.team_id
     where ss.snapshot_date = $1 and ss.conference is not null
     order by ss.conference, ss.points desc, ss.points_pct desc`,
    [date],
  );

  const conferences = [...new Set(rows.map((r) => r.conference))];
  return conferences.map((conference) => {
    const teamsInConf = rows.filter((r) => r.conference === conference);
    const divisions = [...new Set(teamsInConf.map((r) => r.division))];
    const divisionLeaders: Record<string, WildCardTeam[]> = {};
    for (const division of divisions) {
      divisionLeaders[division] = teamsInConf
        .filter((r) => r.division === division && r.division_rank <= 3)
        .sort((a, b) => a.division_rank - b.division_rank);
    }
    const wildCard = teamsInConf.filter((r) => r.division_rank > 3);
    return { conference, divisionLeaders, wildCard };
  });
}
