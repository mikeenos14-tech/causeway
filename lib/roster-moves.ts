// Who's new and who's gone since last season — the NHL's live current
// roster compared with everyone who played for this team last season. The
// site's stats tables only list players once they've played (a deliberate
// rule), so without this a fan checking in before the opener can't see
// that the roster changed at all.
//
// Arrivals show their last NHL team from our own data (or "no NHL games
// yet"); departures (10+ games last season, so call-ups don't clutter it)
// show where they are now from each player's NHL profile.

import { nhlJson } from "./nhl-fetch";
import { pool } from "./db";

const API = "https://api-web.nhle.com/v1";
const DEPARTURE_MIN_GP = 10;

export type Arrival = {
  id: number;
  name: string;
  position: string;
  number: number | null;
  previous: { abbrev: string; season: string; games: number } | null; // last NHL team on file
};

export type Departure = {
  id: number;
  name: string;
  position: string;
  games: number; // for this team last season
  // unknown: the NHL lookup failed, so nothing is claimed (never "none").
  now: { kind: "team"; abbrev: string } | { kind: "system" } | { kind: "none" } | { kind: "unknown" };
};

export type RosterMoves = { lastSeason: string; arrivals: Arrival[]; departures: Departure[] };

type ApiPlayer = { id: number; firstName: { default: string }; lastName: { default: string }; positionCode: string; sweaterNumber?: number };

export async function getRosterMoves(teamAbbrev: string, lastSeason: string): Promise<RosterMoves | null> {
  let current: ApiPlayer[];
  try {
    const data = await nhlJson<{ forwards?: ApiPlayer[]; defensemen?: ApiPlayer[]; goalies?: ApiPlayer[] }>(`${API}/roster/${teamAbbrev}/current`, 3600);
    if (!data) return null;
    current = [...(data.forwards ?? []), ...(data.defensemen ?? []), ...(data.goalies ?? [])];
    if (current.length === 0) return null;
  } catch {
    return null;
  }
  const currentIds = new Set(current.map((p) => p.id));

  // Everyone who played for this team last season, skaters and goalies.
  const { rows: lastRows } = await pool.query(
    `select p.id, p.full_name, p.position, count(*)::int as games
     from (select player_id, game_id, team_id from skater_game_stats
           union all select player_id, game_id, team_id from goalie_game_stats) s
     join games g on g.id = s.game_id
     join teams t on t.id = s.team_id
     join players p on p.id = s.player_id
     where t.abbrev = $1 and g.season_id = $2 and g.game_type = 'regular'
     group by p.id, p.full_name, p.position`,
    [teamAbbrev, lastSeason],
  );
  const lastIds = new Set(lastRows.map((r) => Number(r.id)));

  // Arrivals: on the current roster, didn't play here last season.
  const newcomers = current.filter((p) => !lastIds.has(p.id));
  const { rows: prevRows } = newcomers.length
    ? await pool.query(
        `select distinct on (s.player_id) s.player_id, t.abbrev, g.season_id,
                count(*) over (partition by s.player_id, s.team_id, g.season_id)::int as games
         from (select player_id, game_id, team_id from skater_game_stats
               union all select player_id, game_id, team_id from goalie_game_stats) s
         join games g on g.id = s.game_id
         join teams t on t.id = s.team_id
         where s.player_id = any($1::int[]) and g.game_type = 'regular' and g.season_id <= $2
         order by s.player_id, g.game_date desc`,
        // Capped at last season: once the new season starts, a newcomer's
        // latest game is with this team, which read as "back with BOS".
        [newcomers.map((p) => p.id), lastSeason],
      )
    : { rows: [] };
  const prevById = new Map(prevRows.map((r) => [Number(r.player_id), r]));
  const arrivals: Arrival[] = newcomers.map((p) => {
    const prev = prevById.get(p.id);
    return {
      id: p.id,
      name: `${p.firstName.default} ${p.lastName.default}`,
      position: p.positionCode,
      number: p.sweaterNumber ?? null,
      previous: prev ? { abbrev: prev.abbrev, season: String(prev.season_id), games: prev.games } : null,
    };
  });

  // Departures: regulars last season who aren't on the roster now.
  const leavers = lastRows.filter((r) => !currentIds.has(Number(r.id)) && r.games >= DEPARTURE_MIN_GP);
  const departures: Departure[] = await Promise.all(
    leavers.map(async (r) => {
      // "Not on an NHL roster" only when the NHL actually says so: a failed
      // lookup used to fall through to that claim (found in the
      // 2026-10-01 audit); now it says the status is unavailable.
      let now: Departure["now"] = { kind: "unknown" };
      try {
        const d = await nhlJson<{ isActive?: boolean; currentTeamAbbrev?: string }>(`${API}/player/${r.id}/landing`, 86400);
        if (d) {
          now = d.isActive && d.currentTeamAbbrev ? (d.currentTeamAbbrev === teamAbbrev ? { kind: "system" } : { kind: "team", abbrev: d.currentTeamAbbrev }) : { kind: "none" };
        }
      } catch {
        // stays "unknown"
      }
      return { id: Number(r.id), name: r.full_name, position: r.position, games: r.games, now };
    }),
  );

  arrivals.sort((a, b) => (b.previous?.games ?? -1) - (a.previous?.games ?? -1));
  departures.sort((a, b) => b.games - a.games);
  return { lastSeason, arrivals, departures };
}
