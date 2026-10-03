// Live win probability (lib/live-wp.ts), replayed against real games: every
// distinct NHL landing response the recorder saved on a game night
// (scripts/stats/record-live-games.ts), fed through the live code with
// each game's pregame ratings. Checks the clock arithmetic, that live and
// finished-game charts agree, and unit cases (playoff overtime, shootout,
// intermissions).
//
// Usage: npx tsx --env-file=.env.local scripts/stats/test-live-wp.ts [recordings dir]
// (default: data/raw/live; the recordings aren't in git, so CI skips the replay)

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { pool } from "../../lib/db";
import { getWpModel } from "../../lib/wp-model";
import { getGameWpTimeline } from "../../lib/wp-game";
import { parseLanding, type LiveClock } from "../../lib/live-game";
import { computeLiveWp, liveElapsed, goalElapsed } from "../../lib/live-wp";
import { ELO } from "../../config/stats";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
};

const clk = (period: number, periodType: LiveClock["periodType"], secondsRemaining: number, inIntermission = false): LiveClock => ({ period, periodType, secondsRemaining, inIntermission });

(async () => {
  // Clock arithmetic.
  check("puck drop is 0:00", liveElapsed(clk(1, "REG", 1200), false) === 0);
  check("2nd period, 12:34 left = 27:26 elapsed", liveElapsed(clk(2, "REG", 754), false) === 1200 + 446);
  check("1st intermission pins to 20:00 (the feed's clock counts the intermission)", liveElapsed(clk(1, "REG", 973, true), false) === 1200);
  check("regular-season OT, 1:37 left = 63:23", liveElapsed(clk(4, "OT", 97), false) === 3600 + 203);
  check("playoff 2OT, 5:00 left = 95:00", liveElapsed(clk(5, "OT", 300), true) === 3600 + 1200 + 900);
  check("intermission before playoff 2OT pins to 80:00", liveElapsed(clk(4, "OT", 800, true), true) === 4800);
  check("shootout is 65:00", liveElapsed(clk(5, "SO", 0), false) === 3900);
  check("goal times: 2nd 16:14, OT 1:02, 3OT 4:00", goalElapsed({ period: "2nd", time: "16:14" }) === 2174 && goalElapsed({ period: "OT", time: "1:02" }) === 3662 && goalElapsed({ period: "3OT", time: "4:00" }) === 3600 + 2400 + 240);
  check("odd period label is rejected, not guessed", goalElapsed({ period: "SO", time: "0:00" }) === null);

  const model = (await getWpModel())!;
  const dir = process.argv[2] ?? "data/raw/live";
  if (!existsSync(dir)) {
    console.log(`(no recordings at ${dir}; replay skipped)`);
  } else {
    const pen = ELO.params.b2bPenalty ?? 0;
    for (const night of readdirSync(dir)) {
      for (const gid of readdirSync(path.join(dir, night))) {
        const gameDir = path.join(dir, night, gid);
        const tlPath = path.join(gameDir, "timeline.jsonl");
        if (!existsSync(tlPath)) continue;
        const { rows: [r] } = await pool.query(
          `select h.rating_before::float rh, a.rating_before::float ra,
                  coalesce((select bool_or(back_to_back) from team_rest where game_id = g.id and is_home), false) bh,
                  coalesce((select bool_or(back_to_back) from team_rest where game_id = g.id and not is_home), false) ba
           from nhl_games g join nhl_teams ht on ht.id = g.home_team_id join nhl_teams at on at.id = g.away_team_id
           join elo_history h on h.game_id = g.id and h.franchise_id = ht.lineage_id join elo_history a on a.game_id = g.id and a.franchise_id = at.lineage_id
           where g.id = $1`,
          [Number(gid)],
        );
        if (!r) {
          // Recorded tonight and not loaded yet (in progress, or before the
          // morning rebuild stores its pregame ratings): nothing to replay against.
          console.log(`      (${gid}: not loaded yet; skipped)`);
          continue;
        }
        const gap = r.rh - (r.bh ? pen : 0) - (r.ra - (r.ba ? pen : 0));
        let last = "", prevT = -1, responses = 0, nulls = 0, incomplete = 0, backwards = 0, outOfRange = 0, nowMismatch = 0, intermissionBad = 0;
        let finalWp: ReturnType<typeof computeLiveWp> = null;
        for (const line of readFileSync(tlPath, "utf8").split("\n")) {
          if (!line) continue;
          const h = JSON.parse(line).landingHash;
          if (!h || h === last) continue;
          last = h;
          const f = path.join(gameDir, `${h}.landing.json.gz`);
          if (!existsSync(f)) continue;
          const g = parseLanding(JSON.parse(gunzipSync(readFileSync(f)).toString()));
          if (!["LIVE", "CRIT", "OVER", "FINAL", "OFF"].includes(g.state)) continue;
          responses++;
          const wp = computeLiveWp(g, model, gap);
          if (!wp) {
            nulls++;
            continue;
          }
          if (!(wp.now >= 0 && wp.now <= 1)) outOfRange++;
          if (!wp.timeline) {
            incomplete++;
            continue;
          }
          const t = wp.timeline.endT;
          if (t < prevT - 5) backwards++; // the NHL nudges times by a second or two
          prevT = Math.max(prevT, t);
          if (g.clock?.inIntermission && g.clock.periodType === "REG" && t !== g.clock.period * 1200 && t < 3600) intermissionBad++;
          if (Math.abs(wp.timeline.points.at(-1)!.p - wp.now) > 1e-9) nowMismatch++;
          if (wp.timeline.points.some((x) => x.p < 0 || x.p > 1)) outOfRange++;
          finalWp = wp;
        }
        const fin = await getGameWpTimeline(Number(gid));
        const tag = `${gid} (${responses} live responses)`;
        check(`${tag}: a chance for every live response, all within 0-100%`, nulls === 0 && outOfRange === 0, `${nulls} null, ${outOfRange} out of range`);
        check(`${tag}: game clock never runs backwards; intermissions pinned`, backwards === 0 && intermissionBad === 0, `${backwards} backwards, ${intermissionBad} intermission`);
        check(`${tag}: "now" equals the curve's last point`, nowMismatch === 0, String(nowMismatch));
        if (incomplete) console.log(`      (${incomplete} responses with a goal list short of the score: curve held, "now" still from the score)`);
        // The last live curve against the finished-game chart from the audited
        // goal events: same pregame, same final, same goals, same swing.
        const lt = finalWp?.timeline;
        const ok =
          !!lt && !!fin && !lt.live &&
          Math.abs(lt.pregame - fin.pregame) < 1e-9 &&
          lt.points.at(-1)!.p === fin.points.at(-1)!.p &&
          lt.points.filter((x) => x.goal).length === fin.points.filter((x) => x.goal).length &&
          lt.biggestSwing?.home === fin.biggestSwing?.home &&
          Math.abs((lt.biggestSwing?.t ?? 0) - (fin.biggestSwing?.t ?? 0)) <= 3;
        // Point by point, allowing the feed's second-or-two time differences.
        let maxDiff = 0;
        if (lt && fin) for (const x of fin.points.filter((p) => !p.goal && p.t % 60 === 0)) {
          const y = lt.points.find((p) => p.t === x.t && !p.goal);
          if (y) maxDiff = Math.max(maxDiff, Math.abs(x.p - y.p));
        }
        check(`${tag}: final live curve matches the finished-game chart`, ok && maxDiff < 0.02, `pregame ${lt?.pregame} vs ${fin?.pregame}; swing ${JSON.stringify(lt?.biggestSwing)} vs ${JSON.stringify(fin?.biggestSwing)}; max minute diff ${maxDiff.toFixed(4)}`);
      }
    }
  }
  await pool.end();
  console.log(`\n${failed === 0 ? "All passed." : `${failed} failed.`}`);
  process.exit(failed ? 1 : 0);
})();
