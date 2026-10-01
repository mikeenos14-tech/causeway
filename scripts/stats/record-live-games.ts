// Records real live games for the Live Game Mode replay harness (spec
// section 13: "record the raw feed responses of a few real games, every
// poll, with timestamps"). Polls each of today's games from warmups until
// 30 minutes after the final, every POLL_MS, saving play-by-play and
// landing whenever either changes, plus a timeline line for every poll
// (so a replay knows when nothing changed, too).
//
// Output (local, gitignored): data/raw/live/<date>/<gameId>/
//   timeline.jsonl            one line per poll: {t, state, clock, pbpHash, landingHash}
//   <hash>.pbp.json.gz        each distinct response, stored once
//   <hash>.landing.json.gz
//
// Usage: npx tsx scripts/stats/record-live-games.ts [--date 2026-10-01]

import { mkdirSync, existsSync, writeFileSync, appendFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { join } from "node:path";

const POLL_MS = 12_000;
const AFTER_FINAL_MS = 30 * 60_000;
const UA = { "User-Agent": "causeway-recorder/1.0" };
const i = process.argv.indexOf("--date");
const DATE = i >= 0 ? process.argv[i + 1] : new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const ROOT = join(import.meta.dirname, "..", "..", "data", "raw", "live", DATE);

async function getText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: UA });
    if (!res.ok) return null;
    const text = await res.text();
    JSON.parse(text);
    return text;
  } catch {
    return null;
  }
}

type Tracked = { id: number; label: string; finalAt: number | null; lastPbp?: string; lastLanding?: string; polls: number; saved: number };

async function main() {
  const schedule = JSON.parse((await getText(`https://api-web.nhle.com/v1/schedule/${DATE}`)) ?? "{}");
  const day = (schedule.gameWeek ?? []).find((d: { date: string }) => d.date === DATE);
  const games: Tracked[] = (day?.games ?? [])
    .filter((g: { gameType: number }) => g.gameType === 2 || g.gameType === 3)
    .map((g: { id: number; awayTeam: { abbrev: string }; homeTeam: { abbrev: string } }) => ({ id: g.id, label: `${g.awayTeam.abbrev}@${g.homeTeam.abbrev}`, finalAt: null, polls: 0, saved: 0 }));
  if (!games.length) {
    console.log(`No NHL games on ${DATE}.`);
    return;
  }
  console.log(`Recording ${games.length} games on ${DATE}: ${games.map((g) => g.label).join(", ")}`);

  const starts = new Map<number, number>((day.games as { id: number; startTimeUTC: string }[]).map((g) => [g.id, Date.parse(g.startTimeUTC)]));
  for (;;) {
    const now = Date.now();
    const active = games.filter((g) => (g.finalAt == null || now - g.finalAt < AFTER_FINAL_MS) && now >= (starts.get(g.id) ?? 0) - 45 * 60_000);
    const remaining = games.filter((g) => g.finalAt == null || now - g.finalAt < AFTER_FINAL_MS);
    if (remaining.length === 0) break;

    for (const g of active) {
      const [pbp, landing] = await Promise.all([
        getText(`https://api-web.nhle.com/v1/gamecenter/${g.id}/play-by-play`),
        getText(`https://api-web.nhle.com/v1/gamecenter/${g.id}/landing`),
      ]);
      mkdirSync(join(ROOT, String(g.id)), { recursive: true });
      if (!pbp) {
        appendFileSync(join(ROOT, String(g.id), "timeline.jsonl"), JSON.stringify({ t: new Date().toISOString(), error: "fetch failed" }) + "\n");
        continue;
      }
      const dir = join(ROOT, String(g.id));
      const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);
      const pbpHash = hash(pbp);
      const landingHash = landing ? hash(landing) : null;
      for (const [h, text, kind] of [[pbpHash, pbp, "pbp"], [landingHash, landing, "landing"]] as const) {
        if (h && text && !existsSync(join(dir, `${h}.${kind}.json.gz`))) {
          writeFileSync(join(dir, `${h}.${kind}.json.gz`), gzipSync(text));
          g.saved++;
        }
      }
      const parsed = JSON.parse(pbp);
      appendFileSync(
        join(dir, "timeline.jsonl"),
        JSON.stringify({ t: new Date().toISOString(), state: parsed.gameState, period: parsed.periodDescriptor?.number, clock: parsed.clock?.timeRemaining, intermission: parsed.clock?.inIntermission, pbpHash, landingHash }) + "\n",
      );
      g.polls++;
      if ((parsed.gameState === "FINAL" || parsed.gameState === "OFF") && g.finalAt == null) {
        g.finalAt = Date.now();
        console.log(`${new Date().toISOString()} ${g.label} final; recording 30 more minutes for scoring changes.`);
      }
    }
    if (active.length) console.log(`${new Date().toISOString()} polled ${active.map((g) => `${g.label}(${g.polls}/${g.saved})`).join(" ")}`);
    await new Promise((r) => setTimeout(r, active.length ? POLL_MS : 60_000));
  }
  console.log(`Done: ${games.map((g) => `${g.label} ${g.polls} polls, ${g.saved} distinct responses`).join("; ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
