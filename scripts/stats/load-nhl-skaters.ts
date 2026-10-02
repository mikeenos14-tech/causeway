// Loads per-player box scores for every game before 2007-08 from the cached
// NHL boxscores into nhl_skater_games, and checks each game against the
// separately loaded play-by-play records (nhl_goal_events,
// nhl_penalty_events) before a game page may show it (nhl_box_checks):
//   - every skater's goals equal the goals the play-by-play credits him
//   - each team's assists equal the assists in its goal events
//   - every skater's penalty minutes equal his penalties' minutes
//   - shots: tracked that season, and each team's skater shots add up to
//     its shots total where one is recorded (else the shots column is
//     left off for that game)
// Untracked stats come through the feed as 0; a season counts as tracking
// shots / plus-minus only if 90%+ of its games have nonzero values (both
// start in 1959-60), and otherwise they're stored as null, never 0.
//
// Usage: npx tsx --env-file=.env.local scripts/stats/load-nhl-skaters.ts [--season 19871988]

import { Client } from "pg";
import { readCached } from "./fetch-nhl-history";
import { insertRows } from "../../lib/stats/store-games";

const LAST_SEASON = "20062007"; // the site's own tables start 2007-08
const COLS = ["game_id", "player_id", "team_id", "position", "goals", "assists", "pim", "sog", "plus_minus"];
const seasonArg = process.argv.indexOf("--season");
const ONLY = seasonArg >= 0 ? process.argv[seasonArg + 1] : null;

/* eslint-disable @typescript-eslint/no-explicit-any -- the NHL feed is untyped JSON */
type Skater = { playerId: number; position?: string; goals?: number; assists?: number; pim?: number; sog?: number; plusMinus?: number };

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const { rows: seasonRows } = await db.query(`select distinct season from nhl_games where season <= $1 ${ONLY ? "and season = $2" : ""} order by season`, ONLY ? [LAST_SEASON, ONLY] : [LAST_SEASON]);
  const totals = { games: 0, rows: 0, ok: 0, sogOk: 0, missing: 0 };
  const reasons = new Map<string, number>();

  for (const { season } of seasonRows) {
    const { rows: games } = await db.query(`select id, home_team_id, away_team_id, home_sog, away_sog from nhl_games where season = $1 and game_type in ('regular', 'playoff') order by id`, [season]);
    const ids = games.map((g) => Number(g.id));
    // One query at a time: a single pg client can't run them concurrently.
    const { rows: goals } = await db.query(`select game_id, team_id, scorer_id, assist1_id, assist2_id from nhl_goal_events where game_id = any($1) and period_type <> 'SO'`, [ids]);
    const { rows: pens } = await db.query(`select game_id, team_id, player_id, minutes from nhl_penalty_events where game_id = any($1)`, [ids]);
    const { rows: shots } = await db.query(
      `select game_id, sum(home_shots)::int as home, sum(away_shots)::int as away, bool_and(home_shots is not null and away_shots is not null) as complete from nhl_period_scores where game_id = any($1) group by game_id`,
      [ids],
    );
    const by = <T extends { game_id: number }>(rows: T[]) => {
      const m = new Map<number, T[]>();
      for (const r of rows) m.set(Number(r.game_id), [...(m.get(Number(r.game_id)) ?? []), r]);
      return m;
    };
    const goalsBy = by(goals), pensBy = by(pens);
    const shotsBy = new Map(shots.map((r) => [Number(r.game_id), r]));

    // First pass: read every box, so the season's tracking can be decided.
    const parsed: { g: (typeof games)[number]; sides: { teamId: number; skaters: Skater[]; goalieIds: Set<number> }[] }[] = [];
    let sogGames = 0, pmGames = 0;
    for (const g of games) {
      const box = readCached(season, Number(g.id), "box") as any;
      if (!box?.playerByGameStats) {
        totals.missing++;
        continue;
      }
      const sides = (["homeTeam", "awayTeam"] as const).map((side) => ({
        teamId: Number(side === "homeTeam" ? g.home_team_id : g.away_team_id),
        skaters: [...(box.playerByGameStats[side]?.forwards ?? []), ...(box.playerByGameStats[side]?.defense ?? [])] as Skater[],
        goalieIds: new Set<number>((box.playerByGameStats[side]?.goalies ?? []).map((x: { playerId: number }) => x.playerId)),
      }));
      if (sides.every((s) => s.skaters.reduce((a, p) => a + (p.sog ?? 0), 0) > 0)) sogGames++;
      if (sides.some((s) => s.skaters.some((p) => (p.plusMinus ?? 0) !== 0))) pmGames++;
      parsed.push({ g, sides });
    }
    const sogTracked = parsed.length > 0 && sogGames / parsed.length >= 0.9;
    const pmTracked = parsed.length > 0 && pmGames / parsed.length >= 0.9;

    const out: unknown[][] = [];
    const checks: unknown[][] = [];
    for (const { g, sides } of parsed) {
      const id = Number(g.id);
      const problems: string[] = [];
      const gEv = goalsBy.get(id) ?? [];
      const pEv = pensBy.get(id) ?? [];
      let sogOk = sogTracked;
      for (const { teamId, skaters, goalieIds } of sides) {
        const inBox = new Set(skaters.map((p) => p.playerId));
        // Goals, player by player, and no scorer missing from the box.
        const scored = new Map<number, number>();
        for (const e of gEv.filter((e) => Number(e.team_id) === teamId)) if (e.scorer_id) scored.set(Number(e.scorer_id), (scored.get(Number(e.scorer_id)) ?? 0) + 1);
        for (const p of skaters) if ((p.goals ?? 0) !== (scored.get(p.playerId) ?? 0)) problems.push(`goals ${p.playerId}: box ${p.goals ?? 0}, events ${scored.get(p.playerId) ?? 0}`);
        for (const [pid] of scored) if (!inBox.has(pid)) problems.push(`scorer ${pid} not in box`);
        // Assists, player by player. The boxscore omits goalies' assists
        // (Fuhr, Vernon...) though the play-by-play credits them, so
        // goalies are left out of this check.
        const assisted = new Map<number, number>();
        for (const e of gEv.filter((e) => Number(e.team_id) === teamId))
          for (const a of [e.assist1_id, e.assist2_id]) if (a && !goalieIds.has(Number(a))) assisted.set(Number(a), (assisted.get(Number(a)) ?? 0) + 1);
        for (const p of skaters) if ((p.assists ?? 0) !== (assisted.get(p.playerId) ?? 0)) problems.push(`assists ${p.playerId}: box ${p.assists ?? 0}, events ${assisted.get(p.playerId) ?? 0}`);
        for (const [pid] of assisted) if (!inBox.has(pid)) problems.push(`assister ${pid} not in box`);
        // Penalty minutes, player by player.
        const pim = new Map<number, number>();
        for (const e of pEv) if (e.player_id) pim.set(Number(e.player_id), (pim.get(Number(e.player_id)) ?? 0) + Number(e.minutes ?? 0));
        for (const p of skaters) if ((p.pim ?? 0) !== (pim.get(p.playerId) ?? 0)) problems.push(`pim ${p.playerId}: box ${p.pim ?? 0}, events ${pim.get(p.playerId) ?? 0}`);
        // Shots: add up to the team's official game total (nhl_games); the
        // period-by-period table is only a fallback, as it disagrees with
        // both the box score and the game total in some 1997-2007 games.
        const isHome = teamId === Number(g.home_team_id);
        const official = isHome ? g.home_sog : g.away_sog;
        const s = shotsBy.get(id);
        const teamShots = official != null ? Number(official) : s?.complete ? (isHome ? s.home : s.away) : null;
        const boxShots = skaters.reduce((a, p) => a + (p.sog ?? 0), 0);
        if (sogTracked && teamShots != null && teamShots !== boxShots) sogOk = false;
        for (const p of skaters) {
          out.push([id, p.playerId, teamId, (p.position ?? "").slice(0, 1) || null, p.goals ?? 0, p.assists ?? 0, p.pim ?? 0, sogTracked ? (p.sog ?? 0) : null, pmTracked ? (p.plusMinus ?? 0) : null]);
        }
      }
      const ok = problems.length === 0;
      if (!ok) for (const pr of problems) reasons.set(pr.split(" ")[0], (reasons.get(pr.split(" ")[0]) ?? 0) + 1);
      checks.push([id, ok, ok && sogOk, ok ? null : problems.slice(0, 3).join("; ")]);
      totals.games++;
      if (ok) totals.ok++;
      if (ok && sogOk) totals.sogOk++;
    }
    await db.query("begin");
    await db.query(`delete from nhl_skater_games where game_id = any($1)`, [ids]);
    await db.query(`delete from nhl_box_checks where game_id = any($1)`, [ids]);
    await insertRows(db, "nhl_skater_games", COLS, out);
    await insertRows(db, "nhl_box_checks", ["game_id", "ok", "sog_ok", "reason"], checks);
    await db.query("commit");
    totals.rows += out.length;
    console.log(`${season}: ${parsed.length} games, ${checks.filter((c) => c[1]).length} pass${sogTracked ? `, shots ${checks.filter((c) => c[2]).length}` : ", shots not tracked"}${pmTracked ? "" : ", +/- not tracked"}`);
  }
  await db.end();
  console.log(`\n${totals.games} games, ${totals.rows} player rows; ${totals.ok} pass every check (${((100 * totals.ok) / Math.max(1, totals.games)).toFixed(2)}%), ${totals.sogOk} with checked shots; ${totals.missing} without a cached box score.`);
  console.log("Failures by kind:", Object.fromEntries(reasons));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
