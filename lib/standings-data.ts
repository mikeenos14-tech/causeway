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
