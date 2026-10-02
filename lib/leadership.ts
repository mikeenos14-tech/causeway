// Team captaincy — hand-maintained, because the NHL API exposes no captain
// or alternate designations (checked 2026-09-28: not on /roster, /player
// landing, or /club-stats). Every entry cites its source and date, and only
// holds what that source actually states: alternates stay empty until
// they're officially announced, rather than carried over or guessed.
//
// Shown only for the season it applies to, so last season's stats tables
// never show this season's captain.

export type Leadership = {
  season: string;
  captainId: number | null;
  alternateIds: number[];
  // How many A's the team wears this season (two alongside a captain), so
  // the page can say how many are still unannounced.
  alternateSlots: number;
  source: string;
  alternateSource?: string;
  asOf: string;
};

export const LEADERSHIP: Record<string, Leadership> = {
  BOS: {
    season: "20262027",
    captainId: 8477956, // David Pastrnak, 28th captain in franchise history
    // Charlie McAvoy keeps an A (Boston Globe, 2026-09-27: "McAvoy will
    // continue to wear one of the club's two 'A's"). The second A hadn't
    // been announced as of 2026-10-02. (2025-26: McAvoy, H. Lindholm, Pastrnak.)
    alternateIds: [8479325],
    alternateSlots: 2,
    source: "https://www.nhl.com/bruins/news/bruins-name-david-pastrnak-28th-captain-in-team-history",
    alternateSource: "https://www.bostonglobe.com/2026/09/27/sports/david-pastrnak-boston-bruins-team-captain/",
    asOf: "2026-09-27",
  },
};

export function leadershipBadge(teamAbbrev: string, seasonId: string, playerId: number): "C" | "A" | null {
  const l = LEADERSHIP[teamAbbrev];
  if (!l || l.season !== seasonId) return null;
  if (l.captainId === playerId) return "C";
  if (l.alternateIds.includes(playerId)) return "A";
  return null;
}

// The captain's name for the NHL's current season, or null when the entry
// is for a different season (or there's no entry).
export async function getCurrentCaptainName(teamAbbrev: string, currentSeason: string | null): Promise<string | null> {
  const l = LEADERSHIP[teamAbbrev];
  if (!l || !l.captainId || l.season !== currentSeason) return null;
  const { pool } = await import("./db");
  const { rows } = await pool.query(`select full_name from players where id = $1`, [l.captainId]);
  return rows[0]?.full_name ?? null;
}

// Names of this season's announced alternates, in the order listed.
export async function getAlternateNames(teamAbbrev: string, currentSeason: string | null): Promise<{ id: number; name: string }[]> {
  const l = LEADERSHIP[teamAbbrev];
  if (!l || l.season !== currentSeason || l.alternateIds.length === 0) return [];
  const { pool } = await import("./db");
  const { rows } = await pool.query(`select id, full_name from players where id = any($1::int[])`, [l.alternateIds]);
  const byId = new Map(rows.map((r) => [Number(r.id), r.full_name as string]));
  return l.alternateIds.flatMap((id) => (byId.has(id) ? [{ id, name: byId.get(id)! }] : []));
}
