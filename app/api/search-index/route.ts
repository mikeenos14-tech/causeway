import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

// Everything the header search needs, sent once and searched in the
// browser: every player with a page (anyone who's played since 2007-08)
// and the active teams. Built at most hourly (the aggregate scans every
// game row, ~1.5 s), so typing never waits on the database.
export const revalidate = 3600;

export type SearchIndex = {
  // bos: has played for the Bruins (the site's team), which breaks ties.
  players: { id: number; name: string; pos: string; team: string; to: string; gp: number; bos: boolean }[];
  teams: { abbrev: string; name: string }[];
};

export async function GET() {
  const [{ rows: players }, { rows: teams }] = await Promise.all([
    pool.query(
      `with appearances as (
         select player_id, game_id, team_id from skater_game_stats
         union all select player_id, game_id, team_id from goalie_game_stats where coalesce(toi_seconds, 0) > 0 or decision is not null),
       stats as (
         select a.player_id, max(g.season_id) as last_season,
                (array_agg(t.abbrev order by g.game_date desc))[1] as last_team, count(*)::int as gp,
                bool_or(t.abbrev = 'BOS') as bos
         from appearances a join games g on g.id = a.game_id join teams t on t.id = a.team_id
         group by a.player_id)
       select p.id, p.full_name, p.position, st.last_team, st.last_season, st.gp, st.bos
       from players p join stats st on st.player_id = p.id`,
    ),
    pool.query(`select abbrev, name from teams where is_active order by name`),
  ]);
  const index: SearchIndex = {
    players: players.map((r) => ({ id: r.id, name: r.full_name, pos: r.position, team: r.last_team, to: r.last_season, gp: r.gp, bos: r.bos })),
    teams: teams.map((r) => ({ abbrev: r.abbrev, name: r.name })),
  };
  return NextResponse.json(index, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}
