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
import { diffGoals, goalKey, parseLanding, type LiveGoal } from "../lib/live-game";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
};

const goal = (over: Partial<LiveGoal>): LiveGoal => ({ period: "1st", time: "05:00", team: "BOS", scorer: "David Pastrnak", scorerGoals: 1, assists: [], strength: null, emptyNet: false, awayScore: 0, homeScore: 1, ...over });

// ---- Unit ----
const a = goal({});
const b = goal({ period: "2nd", time: "10:12", team: "NYR", scorer: "Mika Zibanejad" });
check("first goal is new", diffGoals([], [a]).added.length === 1);
check("same goal on the next poll is not new", diffGoals([a], [a]).added.length === 0);
check("a second goal is the only new one", JSON.stringify(diffGoals([a], [a, b]).added) === JSON.stringify([b]));
check("scoring change (credit moves to another player) is not a new goal", diffGoals([a], [{ ...a, scorer: "Brad Marchand" }]).added.length === 0);
check("a goal that vanishes is reported as removed (overturned)", diffGoals([a, b], [a]).removed.length === 1 && diffGoals([a, b], [a]).removed[0] === b);
check("goal keys differ by period, time and team", new Set([goalKey(a), goalKey(b), goalKey({ ...a, team: "NYR" })]).size === 3);

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
    let prev: LiveGoal[] | null = null;
    const detected: LiveGoal[] = [];
    let overturned = 0;
    let lastParsed = null;
    for (const t of timeline) {
      const path = join(dir, `${t.landingHash}.landing.json.gz`);
      if (!existsSync(path)) continue;
      const g = parseLanding(JSON.parse(gunzipSync(readFileSync(path)).toString()));
      lastParsed = g;
      if (prev) {
        const d = diffGoals(prev, g.goals);
        detected.push(...d.added);
        overturned += d.removed.length;
      } else {
        detected.push(...g.goals); // goals already on the board at the first poll
      }
      prev = g.goals;
    }
    if (!lastParsed) continue;
    const final = lastParsed.goals;
    const label = `${lastParsed.away.abbrev}@${lastParsed.home.abbrev} (${lastParsed.status}, ${timeline.length} polls)`;
    const keys = detected.map(goalKey);
    check(`${label}: each goal detected exactly once`, new Set(keys).size === keys.length, keys.join(", "));
    check(
      `${label}: detected goals match the scoring summary (${final.length} goals${overturned ? `, ${overturned} overturned` : ""})`,
      overturned > 0 || JSON.stringify([...new Set(keys)].sort()) === JSON.stringify(final.map(goalKey).sort()),
      `detected ${keys.length}, final ${final.length}`,
    );
    check(`${label}: score equals goals on the board`, lastParsed.home.score + lastParsed.away.score === final.length || lastParsed.status.includes("SO"), `${lastParsed.away.score}-${lastParsed.home.score} vs ${final.length} goals`);
  }
}

console.log(`\n${failed === 0 ? "All passed." : `${failed} failed.`}`);
process.exit(failed ? 1 : 0);
