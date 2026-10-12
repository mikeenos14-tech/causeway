import type { LeagueTeamStats } from "./league-data";

// The stats a team is ranked on (the League page's tiles and each stat's
// full league table, /teams/[abbrev]/league/[metric]), defined once so the
// two can't disagree.

export type LeagueMetric = {
  slug: string;
  label: string;
  value: (t: LeagueTeamStats) => number | null;
  higherIsBetter: boolean;
  format: (v: number) => string;
  // The totals behind the number ("12 for 40"), for the full table.
  detail: (t: LeagueTeamStats) => string;
  // Ranked only once a team's season is fully loaded for it.
  covered: (t: LeagueTeamStats) => boolean;
  group: "results" | "special" | "xg";
};

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const perGame = (v: number) => v.toFixed(2);
const always = () => true;
const special = (t: LeagueTeamStats) => t.specialTeamsCoverage >= 0.99;
const xg = (t: LeagueTeamStats) => t.xgCoverage >= 0.99;
const gp = (t: LeagueTeamStats) => `${t.gamesPlayed} GP`;

export const LEAGUE_METRICS: LeagueMetric[] = [
  { slug: "points-pct", label: "Points %", value: (t) => t.pointsPct, higherIsBetter: true, format: pct, detail: (t) => `${t.points ?? "—"} points in ${gp(t)}`, covered: always, group: "results" },
  { slug: "goals-for", label: "Goals For / Game", value: (t) => t.goalsForPerGame, higherIsBetter: true, format: perGame, detail: (t) => `${t.goalsFor} goals in ${gp(t)}`, covered: always, group: "results" },
  { slug: "goals-against", label: "Goals Against / Game", value: (t) => t.goalsAgainstPerGame, higherIsBetter: false, format: perGame, detail: (t) => `${t.goalsAgainst} allowed in ${gp(t)}`, covered: always, group: "results" },
  { slug: "power-play", label: "Power Play %", value: (t) => t.ppPct, higherIsBetter: true, format: pct, detail: (t) => `${t.ppGoals} for ${t.ppOpportunities}`, covered: special, group: "special" },
  { slug: "penalty-kill", label: "Penalty Kill %", value: (t) => t.pkPct, higherIsBetter: true, format: pct, detail: (t) => `${t.pkTimesShorthanded - t.pkGoalsAgainst} of ${t.pkTimesShorthanded} killed`, covered: special, group: "special" },
  { slug: "faceoffs", label: "Faceoff Win %", value: (t) => t.faceoffWinPct, higherIsBetter: true, format: pct, detail: gp, covered: special, group: "special" },
  { slug: "xg-for", label: "Expected Goals For / Game", value: (t) => t.xgForPerGame, higherIsBetter: true, format: perGame, detail: gp, covered: xg, group: "xg" },
  { slug: "xg-against", label: "Expected Goals Against / Game", value: (t) => t.xgAgainstPerGame, higherIsBetter: false, format: perGame, detail: gp, covered: xg, group: "xg" },
];

export const metricBySlug = (slug: string) => LEAGUE_METRICS.find((m) => m.slug === slug) ?? null;

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
}

// Every covered team, ranked: ties share a rank (1st, T-2nd, T-2nd, 4th).
export function rankAll(teams: LeagueTeamStats[], m: LeagueMetric) {
  const rows = teams.filter((t) => m.covered(t) && m.value(t) != null).map((t) => ({ team: t, value: m.value(t)! }));
  rows.sort((a, b) => (m.higherIsBetter ? b.value - a.value : a.value - b.value) || a.team.abbrev.localeCompare(b.team.abbrev));
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  return rows.map((r) => {
    const better = rows.filter((x) => !same(x.value, r.value) && (m.higherIsBetter ? x.value > r.value : x.value < r.value)).length;
    const tied = rows.filter((x) => same(x.value, r.value)).length > 1;
    return { ...r, rank: better + 1, tied };
  });
}
