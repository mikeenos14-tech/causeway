// The Roster page's player list: the NHL's live current roster, each player
// with this season's stats (dashes until he plays), plus anyone who played
// for the team this season but is no longer on the roster.
//
// It used to be built from game stats alone, so a player appeared only once
// he'd played: on 2026-10-01, 370 of 773 rostered players were missing
// league-wide (Charlie McAvoy on Boston's, Connor Bedard on Chicago's), and
// a team yet to play showed last season's players, departed ones included.

import { pool } from "./db";
import { nhlJson } from "./nhl-fetch";
import { getClubSeason, isFinal } from "./nhl-schedule";
import { seasonByDate } from "./career-trend";
import { getSkaterRosterStats, getGoalieRosterStats, type SkaterRosterRow, type GoalieRosterRow } from "./roster-data";

const API = "https://api-web.nhle.com/v1";

// onRoster false: played for the team this season, not on its roster now.
// hasPage false: no player page yet (no NHL games on file), so no link.
export type RosterFlags = { onRoster: boolean; hasPage: boolean };
export type SkaterLine = SkaterRosterRow & RosterFlags;
export type GoalieLine = GoalieRosterRow & RosterFlags;

export type CurrentRoster = {
  seasonId: string;
  teamGamesPlayed: number;
  rosterAvailable: boolean; // false: no roster synced and the NHL couldn't be reached; list is players who've played
  syncedAt: string | null; // when the roster was last synced from the NHL
  skaters: SkaterLine[];
  goalies: GoalieLine[];
};

type ApiPlayer = { id: number; firstName: { default: string }; lastName: { default: string }; positionCode: string };

const emptySkater = (p: ApiPlayer): SkaterRosterRow => ({
  id: p.id,
  full_name: `${p.firstName.default} ${p.lastName.default}`,
  position: p.positionCode,
  games: 0,
  goals: 0,
  assists: 0,
  points: 0,
  plus_minus: 0,
  pim: 0,
  shots: 0,
  hits: 0,
  blocks: 0,
  pp_goals: 0,
  toiSecondsPerGame: 0,
  shootingPct: null,
});

const emptyGoalie = (p: ApiPlayer): GoalieRosterRow => ({
  id: p.id,
  full_name: `${p.firstName.default} ${p.lastName.default}`,
  games: 0,
  wins: 0,
  losses: 0,
  otl: 0,
  shutouts: 0,
  saves: 0,
  shots_against: 0,
  goals_against: 0,
  toi_seconds: 0,
  savePct: null,
  gaa: null,
});

export async function getCurrentRoster(abbrev: string): Promise<CurrentRoster> {
  const club = await getClubSeason(abbrev).catch(() => null);
  const seasonId = club?.currentSeason ?? seasonByDate(new Date());
  const teamGamesPlayed = club ? club.games.filter((g) => g.season === seasonId && g.gameType === 2 && isFinal(g)).length : 0;

  // The roster as synced hourly into current_rosters (scripts/sync-rosters.ts),
  // so the page never waits on the NHL; the live call is only a fallback for
  // a team with nothing synced yet.
  let rosterSkaters: ApiPlayer[] = [];
  let rosterGoalies: ApiPlayer[] = [];
  let syncedAt: string | null = null;
  const { rows: synced } = await pool.query(`select player_id, full_name, position, synced_at from current_rosters where team_abbrev = $1`, [abbrev]);
  if (synced.length > 0) {
    const asApi = (r: { player_id: number; full_name: string; position: string }): ApiPlayer => {
      const [first, ...rest] = r.full_name.split(" ");
      return { id: Number(r.player_id), firstName: { default: first }, lastName: { default: rest.join(" ") }, positionCode: r.position };
    };
    rosterSkaters = synced.filter((r) => r.position !== "G").map(asApi);
    rosterGoalies = synced.filter((r) => r.position === "G").map(asApi);
    syncedAt = new Date(Math.min(...synced.map((r) => new Date(r.synced_at).getTime()))).toISOString();
  } else {
    try {
      const api = await nhlJson<{ forwards?: ApiPlayer[]; defensemen?: ApiPlayer[]; goalies?: ApiPlayer[] }>(`${API}/roster/${abbrev}/current`, 3600);
      rosterSkaters = api ? [...(api.forwards ?? []), ...(api.defensemen ?? [])] : [];
      rosterGoalies = api?.goalies ?? [];
    } catch {
      // stays empty: the page says the roster couldn't be loaded
    }
  }
  const rosterAvailable = rosterSkaters.length + rosterGoalies.length > 0;

  const [skaterStats, goalieStats] = await Promise.all([getSkaterRosterStats(abbrev, seasonId), getGoalieRosterStats(abbrev, seasonId)]);
  const skaterById = new Map(skaterStats.map((r) => [r.id, r]));
  const goalieById = new Map(goalieStats.map((r) => [r.id, r]));
  const rosterIds = new Set([...rosterSkaters, ...rosterGoalies].map((p) => p.id));

  const allIds = [...rosterIds, ...skaterStats.map((r) => r.id), ...goalieStats.map((r) => r.id)];
  const { rows } = await pool.query(`select id from players where id = any($1::int[])`, [allIds]);
  const withPage = new Set(rows.map((r) => Number(r.id)));
  const flags = (id: number, onRoster: boolean): RosterFlags => ({ onRoster, hasPage: withPage.has(id) });

  if (!rosterAvailable) {
    return {
      seasonId,
      teamGamesPlayed,
      rosterAvailable,
      syncedAt,
      skaters: skaterStats.map((r) => ({ ...r, ...flags(r.id, true) })),
      goalies: goalieStats.map((r) => ({ ...r, ...flags(r.id, true) })),
    };
  }
  const skaters: SkaterLine[] = [
    // Roster names come from the NHL's roster (always the full name); a
    // goalie listed as a skater, or vice versa, can't happen in its feed.
    ...rosterSkaters.map((p) => ({ ...(skaterById.get(p.id) ?? emptySkater(p)), full_name: `${p.firstName.default} ${p.lastName.default}`.trim(), ...flags(p.id, true) })),
    ...skaterStats.filter((r) => !rosterIds.has(r.id)).map((r) => ({ ...r, ...flags(r.id, false) })),
  ];
  const goalies: GoalieLine[] = [
    ...rosterGoalies.map((p) => ({ ...(goalieById.get(p.id) ?? emptyGoalie(p)), full_name: `${p.firstName.default} ${p.lastName.default}`, ...flags(p.id, true) })),
    ...goalieStats.filter((r) => !rosterIds.has(r.id)).map((r) => ({ ...r, ...flags(r.id, false) })),
  ];
  return { seasonId, teamGamesPlayed, rosterAvailable, syncedAt, skaters, goalies };
}
