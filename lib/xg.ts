// Expected goals (xG): how likely each unblocked shot attempt was to score,
// from where it was taken (distance, angle), the shot type, whether it was
// a rebound or off the rush, the manpower, and whether the net was empty.
// A logistic model fitted on every unblocked attempt since 2009-10 (the
// first season the NHL's play-by-play has shot locations), 1.86M shots;
// weights in config/xg-model.json.
//
// Fitted per recording era, because the NHL changed how it records shot
// locations around 2021-22 (shots logged within 10 ft doubled while their
// goal rate fell from about 17% to 12%), and the rebound and rush timings
// drift with it. Current games use the "live" weights, trained on the two
// most recent full seasons and checked on a season they never saw (AUC
// 0.756; 12% better log loss than a flat rate; about 6% high in total,
// equally for both teams).
//
// Used for the chances bar and "deserved to win", not for win
// probability: in-game chances barely predict the rest of a game once the
// score and team strength are known (studied 2026-10-05: at most 0.1%
// better, about half a point of win probability in a tied game).
//
// The feature code mirrors the study that fitted the weights exactly;
// scripts/stats/test-xg.ts checks it against that study's own per-shot
// values for 60 games.

import model from "../config/xg-model.json";

/* eslint-disable @typescript-eslint/no-explicit-any -- the NHL feed is untyped JSON */

export type Shot = {
  t: number; // seconds from the start of the game (OT included)
  period: number;
  home: boolean; // shot by the home team
  goal: boolean;
  emptyNet: boolean; // the defending net was empty
  xg: number;
  shooterId: number | null;
};

const SHOTS: Record<string, boolean> = { goal: true, "shot-on-goal": false, "missed-shot": false };
const TYPES = ["wrist", "snap", "slap", "backhand", "tip-in", "deflected", "wrap-around"];
const HINGES = [5, 10, 15, 20, 25, 30, 40, 50, 60];

function clock(t: string): number {
  const [m, s] = t.split(":").map(Number);
  return m * 60 + s;
}

function features(dist: number, angle: number, shotType: string | undefined, rebound: number, rush: number, own: number, opp: number, emptyNet: number): number[] {
  const f = [1];
  for (const b of HINGES) f.push(Math.max(dist - b, 0) / 100);
  f.push(dist / 100, angle / 90, (angle / 90) ** 2);
  const k = TYPES.indexOf(shotType ?? "");
  for (let i = 0; i < 7; i++) f.push(k === i ? 1 : 0);
  f.push(rebound, rush);
  f.push(own > opp && !emptyNet ? 1 : 0); // power play
  f.push(own < opp ? 1 : 0); // shorthanded
  f.push(own === opp && own < 5 ? 1 : 0); // 4v4 / 3v3
  f.push(emptyNet, emptyNet * (Math.min(dist, 100) / 100));
  return f;
}

export function weightsFor(season: string): number[] {
  if (season >= model.live.fromSeason) return model.live.weights;
  const p = model.periods.find((x) => season >= x.fromSeason && season <= x.toSeason);
  if (!p) throw new Error(`no xG model for season ${season}`);
  return p.weights;
}

export const XG_FIRST_SEASON = model.periods[0].fromSeason;
export const XG_MODEL_VERSION = model.version;

// Every unblocked shot attempt in a game's play-by-play (the NHL's
// gamecenter/{id}/play-by-play), with its xG. Shootout attempts aren't
// included. Returns null before 2009-10 (no shot locations).
export function shotsFromPlayByPlay(pbp: any, weights?: number[]): Shot[] | null {
  const season = String(pbp.season);
  if (season < XG_FIRST_SEASON) return null;
  const w = weights ?? weightsFor(season);
  const playoff = pbp.gameType === 3;
  const homeId = pbp.homeTeam?.id;
  const awayId = pbp.awayTeam?.id;
  const out: Shot[] = [];
  // Which net each team attacks, per period: its offensive-zone shots vote
  // with the sign of x. The NHL's homeTeamDefendingSide is missing for 58%
  // of shots since 2009-10 and sometimes wrong for a whole game (one value
  // all night in Stockholm, 2019-11-08, sending half the shots to the far
  // end); this agrees with it in 99.95% of the periods where it's present.
  const vote = new Map<string, number>();
  for (const e of pbp.plays ?? []) {
    const det = e.details ?? {};
    if (e.typeDescKey in SHOTS && det.zoneCode === "O" && det.xCoord && (det.eventOwnerTeamId === homeId || det.eventOwnerTeamId === awayId)) {
      const key = `${e.periodDescriptor?.number}:${det.eventOwnerTeamId === homeId}`;
      vote.set(key, (vote.get(key) ?? 0) + (det.xCoord > 0 ? 1 : -1));
    }
  }
  const attacksRight = (per: number, isHome: boolean, hdef: string | undefined, x: number): boolean => {
    const v = (p: number, h: boolean) => vote.get(`${p}:${h}`) ?? 0;
    if (v(per, isHome)) return v(per, isHome) > 0;
    if (v(per, !isHome)) return !(v(per, !isHome) > 0);
    for (const q of [per - 1, per + 1]) if (v(q, isHome)) return !(v(q, isHome) > 0);
    if (hdef === "left" || hdef === "right") return isHome ? hdef === "left" : hdef === "right";
    return x > 0;
  };
  let prev: { t: number; k: string; team: number | undefined; zone: string | undefined } | null = null;
  for (const e of pbp.plays ?? []) {
    const pd = e.periodDescriptor ?? {};
    const per: number = pd.number ?? 0;
    if (pd.periodType === "SO" || per === 0 || !e.timeInPeriod) continue;
    const t = per <= 3 ? (per - 1) * 1200 + clock(e.timeInPeriod) : 3600 + (per - 4) * (playoff ? 1200 : 300) + clock(e.timeInPeriod);
    const k: string = e.typeDescKey;
    const det = e.details ?? {};
    if (k in SHOTS) {
      const team = det.eventOwnerTeamId;
      const x = det.xCoord, y = det.yCoord;
      const sc: string = e.situationCode ?? "1551";
      if ((team === homeId || team === awayId) && x != null && y != null && sc.length === 4) {
        const isHome = team === homeId;
        const attRight = attacksRight(per, isHome, e.homeTeamDefendingSide, x);
        const xa = attRight ? x : -x;
        const ya = attRight ? y : -y;
        const dist = Math.hypot(89 - xa, ya);
        const angle = xa < 89 ? (Math.atan2(Math.abs(ya), 89 - xa) * 180) / Math.PI : 90;
        const [ag, ask, hsk, hg] = sc.split("").map(Number);
        const [own, opp] = isHome ? [hsk, ask] : [ask, hsk];
        const emptyNet = (isHome ? ag : hg) === 0 ? 1 : 0;
        let rebound = 0, rush = 0;
        if (prev) {
          const dt = t - prev.t;
          if ((prev.k in SHOTS || prev.k === "blocked-shot") && dt <= 3 && prev.team === team) rebound = 1;
          if (dt <= 4 && (prev.zone === "N" || prev.zone === "D") && !(prev.k in SHOTS)) rush = 1;
        }
        const z = features(dist, angle, det.shotType, rebound, rush, own, opp, emptyNet).reduce((s, v, i) => s + v * w[i], 0);
        out.push({
          t,
          period: per,
          home: isHome,
          goal: SHOTS[k],
          emptyNet: emptyNet === 1,
          xg: 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z)))),
          shooterId: det.shootingPlayerId ?? det.scoringPlayerId ?? null,
        });
      }
    }
    prev = { t, k, team: det.eventOwnerTeamId, zone: det.zoneCode };
  }
  return out;
}

export type GameChances = {
  home: number; // xG with a goalie in net (empty-net shots left out)
  away: number;
  byPeriod: { period: number; home: number; away: number }[];
  shots: { home: number; away: number }; // unblocked attempts, goalie in net
  deservedHome: number; // chance the home team wins on these chances
};

// Distribution of goals from independent chances (each scores with its xG).
function goalsDistribution(xgs: number[]): number[] {
  let dist = [1];
  for (const p of xgs) {
    const next = new Array(dist.length + 1).fill(0);
    for (let k = 0; k < dist.length; k++) {
      next[k] += dist[k] * (1 - p);
      next[k + 1] += dist[k] * p;
    }
    dist = next;
  }
  return dist;
}

// "Deserved to win": replay the game's chances (each one a goal with its
// own probability, independently) and ask how often the home team comes
// out ahead, computed exactly rather than by simulation. A tie counts as
// half (overtime and the shootout are close to a coin flip). Empty-net
// chances are left out: they come from a goalie pulled because the team
// was already behind.
export function gameChances(shots: Shot[]): GameChances {
  const inNet = shots.filter((s) => !s.emptyNet);
  const home = inNet.filter((s) => s.home), away = inNet.filter((s) => !s.home);
  const sum = (a: Shot[]) => a.reduce((s, x) => s + x.xg, 0);
  const h = goalsDistribution(home.map((s) => s.xg)), a = goalsDistribution(away.map((s) => s.xg));
  let win = 0, tie = 0;
  const cumA: number[] = [];
  a.reduce((s, p, i) => (cumA[i] = s + p), 0);
  for (let i = 0; i < h.length; i++) {
    win += h[i] * (i > 0 ? cumA[Math.min(i - 1, a.length - 1)] : 0);
    if (i < a.length) tie += h[i] * a[i];
  }
  const periods = [...new Set(inNet.map((s) => s.period))].sort((x, y) => x - y);
  return {
    home: sum(home),
    away: sum(away),
    byPeriod: periods.map((p) => ({ period: p, home: sum(home.filter((s) => s.period === p)), away: sum(away.filter((s) => s.period === p)) })),
    shots: { home: home.length, away: away.length },
    deservedHome: win + tie / 2,
  };
}

// Stored per game (game_chances). db: anything with query().
export async function saveGameChances(db: { query: (sql: string, params?: unknown[]) => Promise<unknown> }, gameId: number, c: GameChances) {
  const r = (x: number) => Math.round(x * 1000) / 1000;
  await db.query(
    `insert into game_chances (game_id, home_xg, away_xg, by_period, home_shots, away_shots, deserved_home, model_version)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (game_id) do update set home_xg = excluded.home_xg, away_xg = excluded.away_xg, by_period = excluded.by_period,
       home_shots = excluded.home_shots, away_shots = excluded.away_shots, deserved_home = excluded.deserved_home,
       model_version = excluded.model_version, updated_at = now()`,
    [gameId, r(c.home), r(c.away), JSON.stringify(c.byPeriod.map((p) => ({ period: p.period, home: r(p.home), away: r(p.away) }))), c.shots.home, c.shots.away, Math.round(c.deservedHome * 10000) / 10000, XG_MODEL_VERSION],
  );
}
