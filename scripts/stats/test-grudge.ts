// Grudge Index (spec section 9): the decay math, and the spec's acceptance
// criteria against the built tables (scripts/stats/build-grudge.ts).
//
// Usage: npx tsx --env-file=.env.local scripts/stats/test-grudge.ts

import { pool } from "../../lib/db";
import { GRUDGE } from "../../config/stats";
import { eventHeat, heatOn, HeatAccumulator, heatIndex, monthEnds, type GrudgeEvent } from "../../lib/stats/grudge";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
};
const YEAR = 365.25;
const ev = (date: string, type: keyof typeof GRUDGE.events, units = 1): GrudgeEvent => ({
  from: 1, to: 2, date, type, weight: GRUDGE.events[type].weight * units, halfLifeDays: GRUDGE.events[type].halfLifeYears * YEAR, reason: "", gameId: null,
});

(async () => {
  // Math.
  check("an event is at full weight on its day, half after one half-life", Math.abs(eventHeat(ev("2000-01-01", "eliminated"), "2000-01-01") - 25) < 1e-9 && Math.abs(eventHeat(ev("2000-01-01", "eliminated"), "2009-12-31T12:00:00Z".slice(0, 10)) - 12.5) < 0.01);
  check("no heat before an event happens", eventHeat(ev("2010-05-01", "fight"), "2010-04-30") === 0);
  {
    const es = [ev("1990-04-20", "playoffSeries"), ev("1990-04-20", "eliminated"), ev("1991-11-02", "fight", 2), ev("1995-02-14", "regularMeeting"), ev("1999-03-01", "blownLead")];
    const acc = new HeatAccumulator();
    let worst = 0;
    let i = 0;
    for (const m of monthEnds("1990-04-01", "2005-12-31")) {
      for (; i < es.length && es[i].date <= m; i++) { acc.advance(es[i].date); acc.add(es[i]); }
      acc.advance(m);
      worst = Math.max(worst, Math.abs(acc.heat() - heatOn(es, m)));
    }
    check("the running sum equals adding every event up directly", worst < 1e-9, `max diff ${worst}`);
  }
  check("index: 0 for no heat, 100 at the all-time high, rising with heat", heatIndex(0, 650) === 0 && Math.abs(heatIndex(650, 650) - 100) < 1e-9 && heatIndex(10, 650) < heatIndex(100, 650));
  {
    // A rivalry left alone for 20 years: a series lost in 6 games plus a
    // season of meetings, fights and close games. Spec: decays below 10.
    const old = [ev("2000-04-25", "playoffSeries"), ev("2000-04-25", "eliminated"), ...Array.from({ length: 4 }, () => ev("2000-02-01", "regularMeeting")), ev("2000-01-10", "fight", 2), ev("2000-03-03", "closeGame")];
    const h = heatOn(old, "2020-04-25");
    check("20 years without meeting: heat below 10", h < 10, `heat ${h.toFixed(2)}`);
  }

  // The built tables.
  const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
  const many = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows;
  const neg = await one(`select (select count(*) from grudge_monthly where raw_heat < 0 or index_0_100 < 0 or index_0_100 > 100)::int + (select count(*) from grudge_current where raw_heat < 0)::int n`);
  check("heat is never negative; the index stays within 0-100", neg.n === 0, `${neg.n} rows`);
  const n = await one(`select count(*)::int n from grudge_current`);
  check("every pair of current teams has a reading (32 x 31)", n.n === 992, `${n.n}`);

  // Asymmetry: every series raises the loser's heat more than the winner's.
  const series = await many(
    `select e.franchise_from loser, e.franchise_to winner, e.date, e.reason_text from grudge_events e where e.type = 'eliminated' and e.date >= '1980-01-01'`,
  );
  let wrong = 0;
  const heatPair = async (a: number, b: number, on: string) =>
    Number((await one(`select coalesce(sum(weight * power(2, -(($3::date - date))::float / half_life_days)), 0) h from grudge_events where franchise_from = $1 and franchise_to = $2 and date <= $3`, [a, b, on])).h);
  for (const s of series.slice(0, 120)) {
    const day = new Date(s.date).toISOString().slice(0, 10);
    const before = new Date(Date.parse(day) - 86_400_000).toISOString().slice(0, 10);
    const lj = (await heatPair(s.loser, s.winner, day)) - (await heatPair(s.loser, s.winner, before));
    const wj = (await heatPair(s.winner, s.loser, day)) - (await heatPair(s.winner, s.loser, before));
    if (!(lj > wj)) wrong++;
  }
  check(`after a playoff series the loser's heat rises more than the winner's (${Math.min(120, series.length)} series since 1980)`, wrong === 0, `${wrong} exceptions`);

  // Smell tests: Boston-Montreal and Boston-Toronto.
  const yearly = async (from: number, to: number) =>
    new Map((await many(`select extract(year from month)::int y, max(index_0_100) i from grudge_monthly where franchise_from = $1 and franchise_to = $2 group by 1`, [from, to])).map((r) => [r.y, Number(r.i)]));
  const span = (m: Map<number, number>, a: number, b: number) => Math.max(...[...m].filter(([y]) => y >= a && y <= b).map(([, i]) => i));
  const bm = await yearly(6, 1);
  check("BOS-MTL peaks in the 1970s (above the early 1980s)", span(bm, 1970, 1979) > span(bm, 1981, 1983), `${span(bm, 1970, 1979).toFixed(1)} vs ${span(bm, 1981, 1983).toFixed(1)}`);
  check("BOS-MTL peaks in the late 1980s (above the late 1990s by 5+)", span(bm, 1985, 1990) > span(bm, 1997, 2003) + 5, `${span(bm, 1985, 1990).toFixed(1)} vs ${span(bm, 1997, 2003).toFixed(1)}`);
  check("BOS-MTL rises again around 2008-2011 (above 2001-2006)", span(bm, 2008, 2011) > span(bm, 2001, 2006), `${span(bm, 2008, 2011).toFixed(1)} vs ${span(bm, 2001, 2006).toFixed(1)}`);
  const tb = await yearly(5, 6), bt = await yearly(6, 5);
  for (const y of [2013, 2018, 2019, 2024]) check(`TOR toward BOS rises after the ${y} series`, (tb.get(y) ?? 0) > (tb.get(y - 1) ?? 0), `${tb.get(y - 1)?.toFixed(1)} -> ${tb.get(y)?.toFixed(1)}`);
  const hotter = [...tb].filter(([y]) => y >= 2013).every(([y, i]) => i > (bt.get(y) ?? 0));
  check("Toronto's heat toward Boston runs hotter than the reverse (every year since 2013)", hotter);

  await pool.end();
  console.log(`\n${failed === 0 ? "All passed." : `${failed} failed.`}`);
  process.exit(failed ? 1 : 0);
})();
