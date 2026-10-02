// Builds the win probability model (lib/stats/wp.ts) from every game since
// 1917 and tests it on the held-out seasons (every fifth, never used here
// for fitting). Steps, all on TRAINING seasons only:
//   1. each era's league-average home and away scoring rate (regulation)
//   2. what a regulation tie became under each overtime rule (regular season)
//   3. kappa, how strongly the pregame Elo gap scales scoring (grid search)
//   4. the empirical correction table: per (era, regular/playoff, minute,
//      margin) the observed home win/loss rates vs the strength-free model,
//      made monotone in margin (a bigger lead never lowers the win chance)
// Then held-out: log loss and Brier of the home-win chance at every minute
// of every held-out game, against (a) pregame Elo only and (b) score and
// time only (no team strength); calibration by decile; monotonicity.
//
// Usage: npx tsx --env-file=.env.local scripts/stats/build-wp.ts [--dry-run]

import { Client } from "pg";
import { insertRows } from "../../lib/stats/store-games";
import { modelOutcome, winProbability, cellKey, type WpParams, type WpCell, type WpState } from "../../lib/stats/wp";
import { ELO, eraOf, otFormat, isHeldOutSeason } from "../../config/stats";

export const WP_VERSION = "wp-v1-2026-10-02";

type Game = {
  id: number;
  season: string;
  playoff: boolean;
  home: number;
  away: number;
  homeScore: number;
  awayScore: number;
  finalState: string;
  goals: { t: number; home: boolean }[]; // regulation goals, seconds elapsed
  gap: number;
};

async function load(db: Client): Promise<Game[]> {
  const { rows: games } = await db.query(
    `select g.id, g.season, g.game_type = 'playoff' as playoff, g.home_team_id, g.away_team_id, g.home_score, g.away_score, g.final_state,
            h.rating_before::float as rh, a.rating_before::float as ra,
            exists (select 1 from team_rest r where r.game_id = g.id and r.is_home and r.back_to_back) as b2b_h,
            exists (select 1 from team_rest r where r.game_id = g.id and not r.is_home and r.back_to_back) as b2b_a
     from nhl_games g
     join nhl_teams ht on ht.id = g.home_team_id join nhl_teams at on at.id = g.away_team_id
     join elo_history h on h.game_id = g.id and h.franchise_id = ht.lineage_id
     join elo_history a on a.game_id = g.id and a.franchise_id = at.lineage_id
     where g.game_type in ('regular', 'playoff')`,
  );
  const { rows: goals } = await db.query(
    `select e.game_id, e.time_elapsed_sec, e.team_id from nhl_goal_events e where e.period <= 3 and e.period_type = 'REG' and e.time_elapsed_sec is not null`,
  );
  const byGame = new Map<number, { t: number; team: number }[]>();
  for (const r of goals) byGame.set(Number(r.game_id), [...(byGame.get(Number(r.game_id)) ?? []), { t: Number(r.time_elapsed_sec), team: Number(r.team_id) }]);
  const pen = ELO.params.b2bPenalty ?? 0;
  return games.map((g) => ({
    id: Number(g.id),
    season: g.season,
    playoff: g.playoff,
    home: Number(g.home_team_id),
    away: Number(g.away_team_id),
    homeScore: g.home_score,
    awayScore: g.away_score,
    finalState: g.final_state,
    goals: (byGame.get(Number(g.id)) ?? []).map((x) => ({ t: x.t, home: x.team === Number(g.home_team_id) })).sort((a, b) => a.t - b.t),
    gap: g.rh - (g.b2b_h ? pen : 0) - (g.ra - (g.b2b_a ? pen : 0)),
  }));
}

// Regulation goals must add up to the final score minus OT/SO (else the
// game's timeline is incomplete and it's left out).
const complete = (g: Game) => {
  const hg = g.goals.filter((x) => x.home).length, ag = g.goals.length - hg;
  const extra = g.finalState === "OT" || g.finalState === "SO" ? 1 : 0;
  return hg + ag + extra === g.homeScore + g.awayScore && (extra ? Math.abs(hg - ag) === 0 : true);
};

const outcome = (g: Game) => (g.homeScore > g.awayScore ? "win" : g.homeScore < g.awayScore ? "loss" : "tie");

function stateAt(g: Game, minute: number): WpState {
  const t = minute * 60;
  let h = 0, a = 0;
  for (const x of g.goals) {
    if (x.t >= t) continue;
    if (x.home) h++;
    else a++;
  }
  return { era: eraOf(g.season).id, otRule: otFormat(g.season).label, playoff: g.playoff, elapsed: t, inOvertime: false, homeScore: h, awayScore: a, gap: g.gap };
}

function fitParams(train: Game[]): Omit<WpParams, "strength" | "blend"> {
  const eras: WpParams["eras"] = {};
  const byEra = new Map<string, { h: number; a: number; n: number }>();
  for (const g of train) {
    const e = byEra.get(eraOf(g.season).id) ?? { h: 0, a: 0, n: 0 };
    e.h += g.goals.filter((x) => x.home).length;
    e.a += g.goals.filter((x) => !x.home).length;
    e.n++;
    byEra.set(eraOf(g.season).id, e);
  }
  for (const [era, e] of byEra) eras[era] = { homeRate: e.h / e.n / 3600, awayRate: e.a / e.n / 3600 };
  const tieRules: WpParams["tieRules"] = {};
  const byRule = new Map<string, { n: number; w: number; t: number }>();
  for (const g of train) {
    if (g.playoff) continue;
    const hg = g.goals.filter((x) => x.home).length;
    if (hg !== g.goals.length - hg) continue; // not tied after regulation
    const r = byRule.get(otFormat(g.season).label) ?? { n: 0, w: 0, t: 0 };
    r.n++;
    if (g.homeScore > g.awayScore) r.w++;
    if (g.homeScore === g.awayScore) r.t++;
    byRule.set(otFormat(g.season).label, r);
  }
  for (const [rule, r] of byRule) tieRules[rule] = { homeWin: r.w / r.n, tie: r.t / r.n };
  return { eras, tieRules };
}

function buildTable(train: Game[], p: WpParams): Map<string, WpCell> {
  const acc = new Map<string, { n: number; w: number; l: number; mw: number; ml: number }>();
  for (const g of train)
    for (let m = 0; m < 60; m++) {
      const s = stateAt(g, m);
      const key = cellKey(s.era, s.playoff, m, s.homeScore - s.awayScore);
      const neutral = modelOutcome({ ...s, gap: 0 }, p);
      const c = acc.get(key) ?? { n: 0, w: 0, l: 0, mw: 0, ml: 0 };
      c.n++;
      c.w += outcome(g) === "win" ? 1 : 0;
      c.l += outcome(g) === "loss" ? 1 : 0;
      c.mw += neutral.win;
      c.ml += neutral.loss;
      acc.set(key, c);
    }
  // Monotone two ways, by alternating weighted isotonic passes until stable:
  // across margin within each (era, regular/playoff, minute) the win rate
  // rises and the loss rate falls with the lead; across minutes within each
  // (era, regular/playoff, margin) a lead's win rate rises and a deficit's
  // falls as time runs out (raw cells are noisy where data is thin).
  const iso = (vals: number[], ws: number[], increasing: boolean) => {
    const blocks: { v: number; w: number; n: number }[] = [];
    for (let i = 0; i < vals.length; i++) {
      blocks.push({ v: vals[i], w: ws[i], n: 1 });
      while (blocks.length > 1) {
        const [a, b] = blocks.slice(-2);
        if (increasing ? a.v <= b.v : a.v >= b.v) break;
        blocks.splice(-2, 2, { v: (a.v * a.w + b.v * b.w) / (a.w + b.w), w: a.w + b.w, n: a.n + b.n });
      }
    }
    return blocks.flatMap((b) => Array(b.n).fill(b.v));
  };
  const win = new Map([...acc].map(([k, c]) => [k, c.w / c.n]));
  const loss = new Map([...acc].map(([k, c]) => [k, c.l / c.n]));
  const parts = (k: string) => k.split("|");
  const group = (keyOf: (k: string) => string, orderOf: (k: string) => number) => {
    const g = new Map<string, string[]>();
    for (const k of acc.keys()) g.set(keyOf(k), [...(g.get(keyOf(k)) ?? []), k]);
    for (const ks of g.values()) ks.sort((x, y) => orderOf(x) - orderOf(y));
    return [...g.values()];
  };
  const byMargin = group((k) => parts(k).slice(0, 3).join("|"), (k) => Number(parts(k)[3]));
  const byMinute = group((k) => [parts(k)[0], parts(k)[1], parts(k)[3]].join("|"), (k) => Number(parts(k)[2]));
  const apply = (ks: string[], incWin: boolean | null) => {
    const ws = ks.map((k) => acc.get(k)!.n);
    if (incWin === null) return;
    const w = iso(ks.map((k) => win.get(k)!), ws, incWin);
    const l = iso(ks.map((k) => loss.get(k)!), ws, !incWin);
    ks.forEach((k, i) => (win.set(k, w[i]), loss.set(k, l[i])));
  };
  for (let pass = 0; pass < 25; pass++) {
    for (const ks of byMargin) apply(ks, true);
    for (const ks of byMinute) {
      const d = Number(parts(ks[0])[3]);
      apply(ks, d > 0 ? true : d < 0 ? false : null);
    }
  }
  const cells = new Map<string, WpCell>();
  for (const [k, c] of acc) cells.set(k, { n: c.n, win: win.get(k)!, loss: loss.get(k)!, modelWin: c.mw / c.n, modelLoss: c.ml / c.n });
  return cells;
}

function evalSet(games: Game[], f: (g: Game, s: WpState) => number) {
  let ll = 0, br = 0, n = 0;
  const pts: { p: number; y: number }[] = [];
  for (const g of games)
    for (let m = 0; m < 60; m++) {
      const s = stateAt(g, m);
      const p = Math.min(1 - 1e-9, Math.max(1e-9, f(g, s)));
      const y = outcome(g) === "win" ? 1 : 0;
      ll -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
      br += (p - y) ** 2;
      n++;
      pts.push({ p, y });
    }
  return { logLoss: ll / n, brier: br / n, n, pts };
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const all = await load(db);
  const games = all.filter(complete);
  console.log(`${all.length} games; ${games.length} with a complete goal timeline (${all.length - games.length} left out).`);
  const train = games.filter((g) => !isHeldOutSeason(g.season));
  const held = games.filter((g) => isHeldOutSeason(g.season));

  const base = fitParams(train);
  // kappa: grid on training states every 5 minutes (strength only, no table).
  let best = { kappa: 0, ll: Infinity };
  const sampleTrain = train.filter((_, i) => i % 3 === 0);
  for (let kappa = 0; kappa <= 0.006; kappa += 0.0005) {
    let ll = 0, n = 0;
    const p0: WpParams = { ...base, strength: kappa, blend: 200 };
    for (const g of sampleTrain)
      for (let m = 0; m < 60; m += 5) {
        const pr = Math.min(1 - 1e-9, Math.max(1e-9, modelOutcome(stateAt(g, m), p0).win));
        const y = outcome(g) === "win" ? 1 : 0;
        ll -= y * Math.log(pr) + (1 - y) * Math.log(1 - pr);
        n++;
      }
    if (ll / n < best.ll) best = { kappa, ll: ll / n };
  }
  const params: WpParams = { ...base, strength: best.kappa, blend: 200 };
  console.log(`kappa ${best.kappa} (grid 0-0.006)`);
  const table = buildTable(train, params);

  // Held-out tests.
  const full = evalSet(held, (_, s) => winProbability(s, params, table).win);
  const noStrength = evalSet(held, (_, s) => winProbability({ ...s, gap: 0 }, params, table).win);
  const pregame = evalSet(held, (g) => winProbability(stateAt(g, 0), params, table).win);
  const deciles: string[] = [];
  const sorted = [...full.pts].sort((a, b) => a.p - b.p);
  let ece = 0;
  for (let i = 0; i < 10; i++) {
    const s = sorted.slice(Math.floor((i * sorted.length) / 10), Math.floor(((i + 1) * sorted.length) / 10));
    const p = s.reduce((t, x) => t + x.p, 0) / s.length, y = s.reduce((t, x) => t + x.y, 0) / s.length;
    ece += (Math.abs(p - y) * s.length) / sorted.length;
    deciles.push(`${(100 * p).toFixed(1)}→${(100 * y).toFixed(1)}`);
  }
  const metrics = {
    heldOutStates: full.n,
    heldOutGames: held.length,
    logLoss: +full.logLoss.toFixed(5),
    brier: +full.brier.toFixed(5),
    noStrengthLogLoss: +noStrength.logLoss.toFixed(5),
    pregameOnlyLogLoss: +pregame.logLoss.toFixed(5),
    calibrationErrorPts: +(100 * ece).toFixed(2),
    deciles,
  };
  console.log(JSON.stringify(metrics, null, 1));
  if (!dry) {
    await db.query("begin");
    await db.query(`delete from wp_model where model_version = $1`, [WP_VERSION]);
    await db.query(`insert into wp_model (model_version, params, metrics) values ($1, $2, $3)`, [WP_VERSION, params, metrics]);
    await insertRows(db, "wp_cells", ["model_version", "cell", "n", "win", "loss", "model_win", "model_loss"], [...table].map(([k, c]) => [WP_VERSION, k, c.n, c.win, c.loss, c.modelWin, c.modelLoss]));
    await db.query("commit");
    console.log(`Stored ${WP_VERSION}: ${table.size} cells.`);
  }
  await db.end();
}

if (process.argv[1]?.endsWith("build-wp.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
