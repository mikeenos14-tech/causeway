import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

// Everything the header search needs, sent once and searched in the
// browser: every player with a page (every NHL player since 1917-18: the
// site's tables from 2007-08, the history tables before) and the active
// teams. Built at most hourly (the aggregate scans every
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
         select s.player_id, g.season_id as season, g.game_date, t.abbrev as team
         from skater_game_stats s join games g on g.id = s.game_id join teams t on t.id = s.team_id
         union all
         select s.player_id, g.season_id, g.game_date, t.abbrev
         from goalie_game_stats s join games g on g.id = s.game_id join teams t on t.id = s.team_id
         where coalesce(s.toi_seconds, 0) > 0 or s.decision is not null
         union all
         select s.player_id, g.season, g.game_date, t.tri_code
         from nhl_skater_games s join nhl_games g on g.id = s.game_id join nhl_teams t on t.id = s.team_id
         where s.played and g.season < '20072008'
         union all
         select s.player_id, g.season, g.game_date, t.tri_code
         from nhl_goalie_games s join nhl_games g on g.id = s.game_id join nhl_teams t on t.id = s.team_id
         where g.season < '20072008' and (coalesce(s.toi_sec, 1) > 0 or s.decision is not null)),
       stats as (
         select player_id, max(season) as last_season,
                (array_agg(team order by game_date desc))[1] as last_team, count(*)::int as gp,
                bool_or(team = 'BOS') as bos
         from appearances group by player_id)
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
