// Who's new and who's gone since last season — the NHL's live current
// roster compared with everyone who played for this team last season. The
// site's stats tables only list players once they've played (a deliberate
// rule), so without this a fan checking in before the opener can't see
// that the roster changed at all.
//
// Arrivals show their last NHL team from our own data, an earlier stint
// here if they're coming back, and where they played last season if it
// wasn't the NHL (or "no NHL games yet"); departures (10+ games last season, so call-ups don't clutter it)
// show where they are now from each player's NHL profile.

import { nhlJson } from "./nhl-fetch";
import { pool } from "./db";

const API = "https://api-web.nhle.com/v1";
const DEPARTURE_MIN_GP = 10;
// NHL profile lookups (arrivals and departures) at most this many at a time.
// All at once, a team with 15+ roster changes on a cold cache drew 429s,
// and every failed lookup quietly dropped its line ("from Providence").
const LOOKUP_CONCURRENCY = 4;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export type Arrival = {
  id: number;
  name: string;
  position: string;
  number: number | null;
  previous: { abbrev: string; season: string; games: number } | null; // last NHL team on file
  // Earlier games with THIS team (since 2007-08), for a player coming back
  // from somewhere else: "back after 232 GP here (2018-19 to 2022-23)".
  formerStint: { games: number; from: string; to: string } | null;
  // Where he played last season outside the NHL (AHL, college, junior...),
  // from his NHL profile: "up from Providence (AHL)". Null when he played
  // in the NHL last season, or the lookup failed (then nothing is claimed).
  lastSeasonElsewhere: { team: string; league: string; games: number } | null;
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
  // Every earlier stint with this team, to tell a returning player from a
  // newcomer (the last-NHL-team rule alone called Connor Clifton, 232 GP
  // here 2018-23, just "from PIT").
  const { rows: stintRows } = newcomers.length
    ? await pool.query(
        `select s.player_id, count(*)::int as games, min(g.season_id) as first, max(g.season_id) as last
         from (select player_id, game_id, team_id from skater_game_stats
               union all select player_id, game_id, team_id from goalie_game_stats) s
         join games g on g.id = s.game_id join teams t on t.id = s.team_id
         where s.player_id = any($1::int[]) and t.abbrev = $2 and g.game_type = 'regular' and g.season_id <= $3
         group by s.player_id`,
        [newcomers.map((p) => p.id), teamAbbrev, lastSeason],
      )
    : { rows: [] };
  const stintById = new Map(stintRows.map((r) => [Number(r.player_id), r]));
  const arrivals: Arrival[] = await mapLimit(newcomers, LOOKUP_CONCURRENCY, async (p) => {
    const prev = prevById.get(p.id);
    const stint = stintById.get(p.id);
    // Last season outside the NHL, only if he played no NHL games then.
    let lastSeasonElsewhere: Arrival["lastSeasonElsewhere"] = null;
    if (!prev || String(prev.season_id) !== lastSeason) {
      try {
        const d = await nhlJson<{ seasonTotals?: { season: number; gameTypeId: number; leagueAbbrev: string; teamName?: { default: string }; gamesPlayed?: number }[] }>(`${API}/player/${p.id}/landing`, 86400);
        const rows = (d?.seasonTotals ?? []).filter((t) => String(t.season) === lastSeason && t.gameTypeId === 2);
        if (rows.length > 0 && !rows.some((t) => t.leagueAbbrev === "NHL")) {
          const top = [...rows].sort((x, y) => (y.gamesPlayed ?? 0) - (x.gamesPlayed ?? 0))[0];
          if (top.teamName?.default) lastSeasonElsewhere = { team: top.teamName.default, league: top.leagueAbbrev, games: top.gamesPlayed ?? 0 };
        }
      } catch {
        // stays null: nothing claimed
      }
    }
    return {
      id: p.id,
      name: `${p.firstName.default} ${p.lastName.default}`,
      position: p.positionCode,
      number: p.sweaterNumber ?? null,
      previous: prev ? { abbrev: prev.abbrev, season: String(prev.season_id), games: prev.games } : null,
      formerStint: stint && prev && prev.abbrev !== teamAbbrev ? { games: stint.games, from: String(stint.first), to: String(stint.last) } : null,
      lastSeasonElsewhere,
    };
  });

  // Departures: regulars last season who aren't on the roster now.
  const leavers = lastRows.filter((r) => !currentIds.has(Number(r.id)) && r.games >= DEPARTURE_MIN_GP);
  const departures: Departure[] = await mapLimit(leavers, LOOKUP_CONCURRENCY, async (r) => {
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
  });

  arrivals.sort((a, b) => (b.previous?.games ?? -1) - (a.previous?.games ?? -1));
  departures.sort((a, b) => b.games - a.games);
  return { lastSeason, arrivals, departures };
}
