// Expected goals (lib/xg.ts): the port against the study that fitted the
// weights (60 games' per-shot values, scripts/stats/fixtures), and
// "deserved to win" against brute force.
//
// Usage: npx tsx scripts/stats/test-xg.ts
// (the parity part reads the cached play-by-play, data/raw/nhl, which
// isn't in git; CI runs the rest)

import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import model from "../../config/xg-model.json";
import { shotsFromPlayByPlay, gameChances, type Shot } from "../../lib/xg";
import reference from "./fixtures/xg-reference.json";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
};
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
const shot = (home: boolean, xg: number, extra: Partial<Shot> = {}): Shot => ({ t: 0, period: 1, home, goal: false, emptyNet: false, xg, shooterId: null, ...extra });

// Deserved to win, by hand and against enumerating every outcome.
check("no chances: a coin flip", near(gameChances([]).deservedHome, 0.5));
check("one home chance at 0.3: 0.3 + 0.7/2 = 0.65", near(gameChances([shot(true, 0.3)]).deservedHome, 0.65));
check("mirror-image chances: exactly 0.5", near(gameChances([shot(true, 0.2), shot(true, 0.1), shot(false, 0.2), shot(false, 0.1)]).deservedHome, 0.5));
check("empty-net chances don't count", near(gameChances([shot(true, 0.3), shot(false, 0.9, { emptyNet: true })]).deservedHome, 0.65));
{
  const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  let worst = 0;
  for (let trial = 0; trial < 50; trial++) {
    const shots = Array.from({ length: 2 + Math.floor(rnd() * 10) }, () => shot(rnd() < 0.5, rnd() * 0.4));
    let win = 0, tie = 0;
    for (let mask = 0; mask < 1 << shots.length; mask++) {
      let p = 1, h = 0, a = 0;
      shots.forEach((s, i) => {
        const scored = (mask >> i) & 1;
        p *= scored ? s.xg : 1 - s.xg;
        if (scored && s.home) h++;
        else if (scored) a++;
      });
      if (h > a) win += p;
      else if (h === a) tie += p;
    }
    worst = Math.max(worst, Math.abs(gameChances(shots).deservedHome - (win + tie / 2)));
  }
  check("deserved-to-win matches every-outcome enumeration (50 random games)", worst < 1e-12, `max diff ${worst}`);
}
{
  const g = gameChances([shot(true, 0.1, { period: 1 }), shot(false, 0.2, { period: 2 }), shot(true, 0.05, { period: 4 })]);
  check("totals and periods add up", near(g.home, 0.15) && near(g.away, 0.2) && g.byPeriod.length === 3 && near(g.byPeriod[2].home, 0.05));
}

// Parity with the study, shot by shot.
const ref = reference as Record<string, { season: number; t: number[]; home: number[]; xg: number[] }>;
let games = 0, worst = 0, mismatched = 0;
for (const [gid, r] of Object.entries(ref)) {
  const season = `${r.season}${r.season + 1}`;
  const f = path.join("data/raw/nhl", season, `${gid}.pbp.json.gz`);
  if (!existsSync(f)) continue;
  const pbp = JSON.parse(gunzipSync(readFileSync(f)).toString());
  const period = model.periods.find((p) => season >= p.fromSeason && season <= p.toSeason)!;
  const shots = shotsFromPlayByPlay(pbp, period.weights)!;
  games++;
  if (shots.length !== r.xg.length) {
    mismatched++;
    console.log(`      ${gid}: ${shots.length} shots here, ${r.xg.length} in the study`);
    continue;
  }
  shots.forEach((s, i) => {
    worst = Math.max(worst, Math.abs(s.xg - r.xg[i]));
    if (s.t !== r.t[i] || (s.home ? 1 : 0) !== r.home[i]) mismatched++;
  });
}
if (games) check(`port matches the study shot by shot (${games} games)`, mismatched === 0 && worst < 2e-6, `${mismatched} mismatched, worst xG diff ${worst}`);
else console.log("(no cached play-by-play; parity skipped)");

// Direction: a game where the NHL's defending-side flag says "right" all
// night (as in Stockholm, 2019-11-08) while the home team attacks left in
// the 1st and right in the 2nd. Each team's offensive-zone shots decide.
{
  const play = (per: number, team: number, x: number, k = "shot-on-goal", zone = "O") => ({
    typeDescKey: k, periodDescriptor: { number: per, periodType: "REG" }, timeInPeriod: "05:00", situationCode: "1551",
    homeTeamDefendingSide: "right", details: { xCoord: x, yCoord: 0, zoneCode: zone, eventOwnerTeamId: team, shotType: "wrist" },
  });
  const pbp = { season: 20252026, gameType: 2, homeTeam: { id: 1 }, awayTeam: { id: 2 }, plays: [
    play(1, 1, -70), play(1, 1, -60), play(1, 2, 70), play(1, 1, -80), // home attacks left in the 1st
    play(2, 1, 80), play(2, 2, -60), // and right in the 2nd
  ] };
  const shots = shotsFromPlayByPlay(pbp)!;
  const slot = shots[3], second = shots[4];
  check("direction from where each team shoots, not a wrong flag: a 9-ft shot is dangerous", slot.xg > 0.1 && second.xg > 0.1, `xG ${slot.xg.toFixed(3)}, ${second.xg.toFixed(3)}`);
}

check("pre-2009-10 games have no xG (no shot locations)", shotsFromPlayByPlay({ season: 20082009, plays: [] }) === null);

console.log(`\n${failed === 0 ? "All passed." : `${failed} failed.`}`);
process.exit(failed ? 1 : 0);
