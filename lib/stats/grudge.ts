// Grudge Index math (spec section 9). Pure functions, unit-tested in
// scripts/stats/test-grudge.ts. Heat is directional (A's grudge toward B):
//   heat(t) = sum over events of weight * 2^(-(t - t_event) / halfLife)
// and the 0-100 index places it on a log scale against the hottest any
// rivalry has ever been (heatIndex below).

export type GrudgeEvent = { from: number; to: number; date: string; type: string; weight: number; halfLifeDays: number; reason: string; gameId: number | null };

const DAY = 86_400_000;
export const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY;

// One event's heat on a date (0 before it happened).
export function eventHeat(e: Pick<GrudgeEvent, "date" | "weight" | "halfLifeDays">, on: string): number {
  const d = daysBetween(e.date, on);
  return d < 0 ? 0 : e.weight * Math.pow(2, -d / e.halfLifeDays);
}

export function heatOn(events: GrudgeEvent[], on: string): number {
  return events.reduce((s, e) => s + eventHeat(e, on), 0);
}

// Last day of every month from the first event's month through `until`.
export function monthEnds(from: string, until: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  for (;;) {
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    if (end > until) break;
    out.push(end);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

// The 0-100 index: log heat relative to the hottest any rivalry has ever
// been (100). Changed from the spec's percentile (2026-10-05): about 1% of
// all rivalry-months sit above heat 270, and Boston-Montreal spent decades
// there, so a percentile pinned it at 99-100 from the 1950s to 2016 and
// hid the peaks the spec's own smell test expects (the 1970s, 1988, 2008-
// 2011). On the log scale those peaks read about 90, 100 and 91, a typical
// division rival about 50.
export function heatIndex(heat: number, maxHeat: number): number {
  if (heat <= 0 || maxHeat <= 0) return 0;
  return Math.min(100, (100 * Math.log1p(heat)) / Math.log1p(maxHeat));
}

// Heat for many events at a series of dates, fast: one running sum per
// half-life, decayed forward (exact, since 2^-a * 2^-b = 2^-(a+b)).
export class HeatAccumulator {
  private sums = new Map<number, number>(); // half-life -> heat as of `at`
  private at: string | null = null;
  advance(to: string) {
    if (this.at && to > this.at) {
      const d = daysBetween(this.at, to);
      for (const [h, s] of this.sums) this.sums.set(h, s * Math.pow(2, -d / h));
    }
    if (!this.at || to > this.at) this.at = to;
  }
  add(e: Pick<GrudgeEvent, "date" | "weight" | "halfLifeDays">) {
    // Caller adds events in date order and advances to each event's date first.
    this.sums.set(e.halfLifeDays, (this.sums.get(e.halfLifeDays) ?? 0) + e.weight);
  }
  heat(): number {
    let s = 0;
    for (const v of this.sums.values()) s += v;
    return s;
  }
}
