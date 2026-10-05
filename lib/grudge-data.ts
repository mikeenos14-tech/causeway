import { pool } from "./db";

// Grudge Index reads (built by scripts/stats/build-grudge.ts; the model in
// lib/stats/grudge.ts). Franchises are NHL lineages; each is shown as its
// current team (Utah, not Arizona; Dallas, not the North Stars).

export type GrudgeReason = { text: string; type: string; date: string; heat: number };
export type GrudgeSide = { index: number; raw: number; top: GrudgeReason[]; peakIndex: number; peakMonth: string | null };
export type Team = { franchise: number; abbrev: string; name: string };

// 0-100 bands, for the label beside the number.
export function heatLabel(index: number): string {
  if (index >= 90) return "Boiling";
  if (index >= 75) return "Hot";
  if (index >= 60) return "Warm";
  if (index >= 40) return "Simmering";
  return "Cold";
}

type Era = { franchise: number; abbrev: string; name: string; first: string; last: string };
let teamsCache: { at: number; byFranchise: Map<number, Team>; byAbbrev: Map<string, Team>; eras: Era[] } | null = null;
// Current teams: each franchise's most recent club.
export async function grudgeTeams() {
  if (teamsCache && Date.now() - teamsCache.at < 3600_000) return teamsCache;
  const { rows } = await pool.query(
    `select distinct on (t.lineage_id) t.lineage_id, t.tri_code, t.full_name
     from nhl_teams t join (select team, max(d) d from (select home_team_id team, game_date d from nhl_games union all select away_team_id, game_date from nhl_games) x group by team) l on l.team = t.id
     where t.lineage_id in (select franchise_from from grudge_current)
     order by t.lineage_id, l.d desc`,
  );
  const list: Team[] = rows.map((r) => ({ franchise: Number(r.lineage_id), abbrev: r.tri_code, name: r.full_name }));
  // Every club each franchise has been, with its span (Quebec, then Colorado).
  const { rows: eraRows } = await pool.query(
    `select t.lineage_id, t.tri_code, t.full_name, to_char(min(x.d), 'YYYY-MM-DD') first, to_char(max(x.d), 'YYYY-MM-DD') last
     from nhl_teams t join (select home_team_id team, game_date d from nhl_games union all select away_team_id, game_date from nhl_games) x on x.team = t.id
     group by 1, 2, 3`,
  );
  const eras = eraRows.map((r) => ({ franchise: Number(r.lineage_id), abbrev: r.tri_code, name: r.full_name, first: r.first, last: r.last }));
  teamsCache = { at: Date.now(), byFranchise: new Map(list.map((t) => [t.franchise, t])), byAbbrev: new Map(list.map((t) => [t.abbrev, t])), eras };
  return teamsCache;
}

// The club a franchise was on a date (falls back to today's club).
export async function teamOn(franchise: number, date: string | null): Promise<Team | null> {
  const { eras, byFranchise } = await grudgeTeams();
  const e = date ? eras.filter((x) => x.franchise === franchise && x.first <= date).sort((a, b) => (a.last < b.last ? 1 : -1))[0] : undefined;
  return e ? { franchise, abbrev: e.abbrev, name: e.name } : byFranchise.get(franchise) ?? null;
}

const side = (r: Record<string, unknown> | undefined): GrudgeSide =>
  r
    ? { index: Number(r.index_0_100), raw: Number(r.raw_heat), top: r.top_reasons as GrudgeReason[], peakIndex: Number(r.peak_index), peakMonth: r.peak_month ? new Date(r.peak_month as string).toISOString().slice(0, 10) : null }
    : { index: 0, raw: 0, top: [], peakIndex: 0, peakMonth: null };

export type GrudgePair = { a: Team; b: Team; ab: GrudgeSide; ba: GrudgeSide };

async function pairs(where: string, args: unknown[]): Promise<GrudgePair[]> {
  const { byFranchise } = await grudgeTeams();
  const { rows } = await pool.query(`select * from grudge_current where ${where}`, args);
  const map = new Map(rows.map((r) => [`${r.franchise_from}:${r.franchise_to}`, r]));
  const out: GrudgePair[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const [x, y] = [Number(r.franchise_from), Number(r.franchise_to)];
    const key = x < y ? `${x}:${y}` : `${y}:${x}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const a = byFranchise.get(x), b = byFranchise.get(y);
    if (!a || !b) continue;
    out.push({ a, b, ab: side(map.get(`${x}:${y}`)), ba: side(map.get(`${y}:${x}`)) });
  }
  return out;
}

// The two directions between two current teams (a's grudge toward b first).
export async function getGrudge(aAbbrev: string, bAbbrev: string): Promise<GrudgePair | null> {
  const { byAbbrev } = await grudgeTeams();
  const a = byAbbrev.get(aAbbrev), b = byAbbrev.get(bAbbrev);
  if (!a || !b || a.franchise === b.franchise) return null;
  const { rows } = await pool.query(`select * from grudge_current where (franchise_from, franchise_to) in (($1, $2), ($2, $1))`, [a.franchise, b.franchise]);
  return { a, b, ab: side(rows.find((r) => Number(r.franchise_from) === a.franchise)), ba: side(rows.find((r) => Number(r.franchise_from) === b.franchise)) };
}

const hotter = (p: GrudgePair) => Math.max(p.ab.index, p.ba.index);

// League-wide, hottest first (a pair ranks by its hotter direction).
export async function getHottestRivalries(limit = 10): Promise<GrudgePair[]> {
  return (await pairs("true", [])).sort((x, y) => hotter(y) - hotter(x)).slice(0, limit);
}

// Biggest fall from a pair's peak (in its hotter direction) to now, with
// the clubs as they were at the peak (Quebec-Hartford, not Colorado-Carolina).
export async function getColdWars(limit = 8): Promise<(GrudgePair & { drop: number; peak: number; peakMonth: string | null; thenA: Team; thenB: Team })[]> {
  const top = (await pairs("true", []))
    .map((p) => {
      const dir = p.ab.peakIndex >= p.ba.peakIndex ? p.ab : p.ba;
      return { ...p, peak: dir.peakIndex, peakMonth: dir.peakMonth, drop: dir.peakIndex - Math.max(p.ab.index, p.ba.index) };
    })
    .sort((x, y) => y.drop - x.drop)
    .slice(0, limit);
  return Promise.all(top.map(async (p) => ({ ...p, thenA: (await teamOn(p.a.franchise, p.peakMonth)) ?? p.a, thenB: (await teamOn(p.b.franchise, p.peakMonth)) ?? p.b })));
}

// Every rivalry for one team, hottest first, with that team as `a`.
export async function getTeamRivalries(abbrev: string): Promise<GrudgePair[]> {
  const { byAbbrev } = await grudgeTeams();
  const t = byAbbrev.get(abbrev);
  if (!t) return [];
  const list = await pairs("franchise_from = $1 or franchise_to = $1", [t.franchise]);
  return list.map((p) => (p.a.franchise === t.franchise ? p : { a: p.b, b: p.a, ab: p.ba, ba: p.ab })).sort((x, y) => hotter(y) - hotter(x));
}

// Monthly index both ways, from the pair's first event.
export async function getGrudgeTimeline(a: Team, b: Team): Promise<{ month: string; ab: number; ba: number }[]> {
  const { rows } = await pool.query(
    `select to_char(month, 'YYYY-MM-DD') m, max(case when franchise_from = $1 then index_0_100 end) ab, max(case when franchise_from = $2 then index_0_100 end) ba
     from grudge_monthly where (franchise_from, franchise_to) in (($1, $2), ($2, $1)) group by month order by month`,
    [a.franchise, b.franchise],
  );
  const first = rows.findIndex((r) => Number(r.ab) > 0 || Number(r.ba) > 0);
  return rows.slice(Math.max(0, first)).map((r) => ({ month: r.m, ab: Number(r.ab ?? 0), ba: Number(r.ba ?? 0) }));
}

export type GrudgeMoment = { date: string; kind: "series" | "blown" | "ejection" | "fights" | "pim"; text: string; gameId: number | null };

// The rivalry's defining moments: every playoff series and blown 3-goal
// lead, then the serious incidents (match penalties, gross misconducts,
// games with 3+ fights or the most penalty minutes), newest first.
export async function getGrudgeMoments(a: Team, b: Team, limit = 40): Promise<GrudgeMoment[]> {
  const { rows } = await pool.query(
    `select to_char(date, 'YYYY-MM-DD') d, type, reason_text, game_id, weight, franchise_from from grudge_events
     where (franchise_from, franchise_to) in (($1, $2), ($2, $1))
       and (type in ('eliminated', 'blownLead') or (type = 'ejection' and reason_text ~ '^(Match|Gross)') or (type = 'fight' and weight >= 9) or (type = 'excessPim' and weight >= 12))
     order by date desc`,
    [a.franchise, b.franchise],
  );
  const seen = new Set<string>();
  const out: GrudgeMoment[] = [];
  for (const r of rows) {
    const from = Number(r.franchise_from) === a.franchise ? a : b;
    let text: string = r.reason_text, kind: GrudgeMoment["kind"];
    if (r.type === "eliminated") {
      kind = "series";
      const m = /^Eliminated by the (.+), (\d{4} Round \d)$/.exec(r.reason_text);
      text = m ? `${m[1]} eliminated the ${from.name} (${m[2]})` : r.reason_text;
    } else if (r.type === "blownLead") {
      kind = "blown";
      text = `${from.name}: ${r.reason_text[0].toLowerCase()}${r.reason_text.slice(1)}`;
    } else if (r.type === "ejection") kind = "ejection";
    else if (r.type === "fight") kind = "fights";
    else kind = "pim";
    text = text.replace(/, [A-Z][a-z]{2} \d{1,2}, \d{4}$/, ""); // the date has its own column
    const key = `${r.type}:${r.game_id ?? r.d}`; // fights and PIM are stored both ways
    if ((kind === "fights" || kind === "pim") && seen.has(key)) continue;
    seen.add(key);
    out.push({ date: r.d, kind, text, gameId: r.game_id == null ? null : Number(r.game_id) });
  }
  // Every series and blown lead; incidents fill what's left of the limit.
  const major = out.filter((m) => m.kind === "series" || m.kind === "blown");
  const rest = out.filter((m) => m.kind !== "series" && m.kind !== "blown").slice(0, Math.max(0, limit - major.length));
  return [...major, ...rest].sort((x, y) => (x.date < y.date ? 1 : -1));
}
