// Tests for the live scoreboard's logic (lib/live-game.ts):
//   1. unit cases for goal diffing (new goals, overturned goals, scoring
//      changes that must NOT count as a new goal);
//   2. a replay of real recorded games (scripts/stats/record-live-games.ts),
//      poll by poll, through the same parser and diff the scoreboard uses:
//      every goal must be detected exactly once, and the goals detected
//      over the game must equal the final scoring summary.
//
// Usage: npx tsx scripts/test-live-game.ts [--date 2026-10-01]

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { diffGoals, goalKey, parseLanding, trackGoals, startTracking, boardGoals, finalAndComplete, type LiveGoal, type GoalTracker } from "../lib/live-game";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
};

const goal = (over: Partial<LiveGoal>): LiveGoal => ({ eventId: 101, period: "1st", time: "05:00", team: "BOS", scorer: "David Pastrnak", scorerGoals: 1, assists: [], strength: null, emptyNet: false, awayScore: 0, homeScore: 1, ...over });

// ---- Unit ----
const a = goal({});
const b = goal({ eventId: 202, period: "2nd", time: "10:12", team: "NYR", scorer: "Mika Zibanejad" });
check("first goal is new", diffGoals([], [a]).added.length === 1);
check("same goal on the next poll is not new", diffGoals([a], [a]).added.length === 0);
check("a second goal is the only new one", JSON.stringify(diffGoals([a], [a, b]).added) === JSON.stringify([b]));
check("scoring change (credit moves to another player) is not a new goal", diffGoals([a], [{ ...a, scorer: "Brad Marchand" }]).added.length === 0);
check("a goal that vanishes is reported as removed (overturned)", diffGoals([a, b], [a]).removed.length === 1 && diffGoals([a, b], [a]).removed[0] === b);
// The tracker (what the scoreboard uses): the feed's flicker on 2026-10-01.
{
  const team = (abbrev: string, score: number) => ({ abbrev, name: abbrev, score, sog: null });
  const game = (goals: LiveGoal[], away: number, home: number) => ({ goals, away: team(a.team === "BOS" ? "NYR" : "BOS", away), home: team(a.team, home) });
  let st: GoalTracker = startTracking(game([a], 0, 1));
  let r = trackGoals(st, game([], 0, 1)); // goal drops off the list, score still 1
  check("flicker: a goal missing from the list while the score still counts it is NOT overturned", r.removed.length === 0 && r.added.length === 0);
  st = r.state;
  r = trackGoals(st, game([a], 0, 1)); // and comes back
  check("flicker: when it comes back it is not a new goal (no second goal light)", r.added.length === 0 && r.restored.length === 0);
  st = r.state;
  r = trackGoals(st, game([], 0, 0)); // real overturn: list AND score drop
  check("a real overturn (goal gone and the score drops) is reported once", r.removed.length === 1 && r.removed[0] === a);
  st = r.state;
  r = trackGoals(st, game([], 0, 0));
  check("an overturn isn't reported again on the next poll", r.removed.length === 0);
  st = r.state;
  r = trackGoals(st, game([a], 0, 1)); // overturn reversed (or the score dipped by mistake)
  check("a goal back after an overturn is restored, never celebrated twice", r.added.length === 0 && r.restored.length === 1);
  const sh = trackGoals(startTracking(game([a], 0, 1)), game([a], 0, 2)); // shootout winner counts in the score, not the list
  check("shootout: a score above the goal list never invents an overturn", sh.removed.length === 0 && sh.added.length === 0);
}
check("NHL time correction (11:10 -> 11:12, same event) is neither new nor removed", (() => { const d = diffGoals([a], [{ ...a, time: "05:02" }]); return d.added.length === 0 && d.removed.length === 0; })());
check("without event ids, keys fall back to period, time and team", new Set([goalKey({ ...a, eventId: null }), goalKey({ ...b, eventId: null }), goalKey({ ...a, eventId: null, team: "NYR" })]).size === 3);

// ---- Replay recorded games ----
const i = process.argv.indexOf("--date");
const date = i >= 0 ? process.argv[i + 1] : "2026-10-01";
const root = join(import.meta.dirname, "..", "data", "raw", "live", date);
if (!existsSync(root)) {
  console.log(`\nNo recordings for ${date}; replay skipped.`);
} else {
  for (const id of readdirSync(root)) {
    const dir = join(root, id);
    const timeline = readFileSync(join(dir, "timeline.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((t) => t.landingHash);
    let prev: GoalTracker | null = null;
    const detected: LiveGoal[] = [];
    let overturned = 0;
    let lastParsed = null;
    for (const t of timeline) {
      const path = join(dir, `${t.landingHash}.landing.json.gz`);
      if (!existsSync(path)) continue;
      const g = parseLanding(JSON.parse(gunzipSync(readFileSync(path)).toString()));
      lastParsed = g;
      if (prev) {
        const d = trackGoals(prev, g);
        detected.push(...d.added);
        overturned += d.removed.length - d.restored.length;
        prev = d.state;
      } else {
        detected.push(...g.goals); // goals already on the board at the first poll
        prev = startTracking(g);
      }
    }
    if (!lastParsed) continue;
    // The scoreboard stops polling at the first final where every goal is
    // on the board; at that poll the board must show the final summary.
    {
      let st: GoalTracker | null = null;
      let stoppedAt: { goals: number; score: number } | null = null;
      for (const t of timeline) {
        const path = join(dir, `${t.landingHash}.landing.json.gz`);
        if (!existsSync(path)) continue;
        const g = parseLanding(JSON.parse(gunzipSync(readFileSync(path)).toString()));
        st = st ? trackGoals(st, g).state : startTracking(g);
        if (finalAndComplete(g, st)) {
          stoppedAt = { goals: boardGoals(st).length, score: g.away.score + g.home.score - (g.status.includes("SO") ? 1 : 0) };
          break;
        }
      }
      check(`${lastParsed.away.abbrev}@${lastParsed.home.abbrev}: when the board stops polling it shows every goal`, !!stoppedAt && stoppedAt.goals === stoppedAt.score && stoppedAt.goals === lastParsed.goals.length, JSON.stringify(stoppedAt));
    }
    // OVER (horn gone, not yet official): shown as a final, never as
    // "Not started" (which flipped the board back to the preview).
    for (const t of timeline) {
      const path = join(dir, `${t.landingHash}.landing.json.gz`);
      if (!existsSync(path)) continue;
      const g = parseLanding(JSON.parse(gunzipSync(readFileSync(path)).toString()));
      if (g.state !== "OVER") continue;
      check(`${lastParsed.away.abbrev}@${lastParsed.home.abbrev}: OVER reads as a final ("${g.status}")`, g.status.startsWith("Final"), g.status);
      break;
    }
    const final = lastParsed.goals;
    const label = `${lastParsed.away.abbrev}@${lastParsed.home.abbrev} (${lastParsed.status}, ${timeline.length} polls)`;
    const keys = detected.map(goalKey);
    const finalKeys = new Set(final.map(goalKey));
    check(`${label}: each goal detected exactly once`, new Set(keys).size === keys.length, keys.join(", "));
    // The double-fire the first version had: the same team and period
    // "scoring" twice within 10 seconds of game time.
    const sec = (t: string) => Number(t.split(":")[0]) * 60 + Number(t.split(":")[1]);
    const doubles = detected.filter((x, i) => detected.some((y, j) => j < i && y.team === x.team && y.period === x.period && Math.abs(sec(y.time) - sec(x.time)) <= 10));
    check(`${label}: no goal fires twice`, doubles.length === 0, doubles.map((x) => `${x.period} ${x.time} ${x.scorer}`).join(", "));
    // Every final goal was detected; anything detected but not final must
    // have been reported as overturned, and nothing else was.
    const missing = [...finalKeys].filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !finalKeys.has(k));
    check(`${label}: every goal in the final summary was detected (${final.length})`, missing.length === 0, missing.join(", "));
    check(`${label}: overturns (${overturned}) account exactly for goals no longer on the board`, extra.length === overturned, `extra ${extra.length}, overturned ${overturned}`);
    check(`${label}: score equals goals on the board`, lastParsed.home.score + lastParsed.away.score === final.length || lastParsed.status.includes("SO"), `${lastParsed.away.score}-${lastParsed.home.score} vs ${final.length} goals`);
  }
}

console.log(`\n${failed === 0 ? "All passed." : `${failed} failed.`}`);
process.exit(failed ? 1 : 0);
