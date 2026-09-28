// Repair for goalie_game_stats bugs found in the 2026-09-28 product
// review, all in scripts/backfill-season.ts (fixed there too):
//
// 1. Regular-season OT/shootout losses stored with a NULL decision. The
//    NHL API reports them as decision "O"; the mapping only recognized
//    "W"/"L", so ~5,300 goalie-games league-wide lost their OTL and every
//    goalie record on the site read W-L-0.
// 2. "L" in an overtime game rewritten to OTL. That's wrong both times it
//    happens: a playoff OT loss is just a loss (playoffs have no OTL,
//    ~395 rows), and a regular-season "L" in OT is the NHL's pulled-goalie
//    rule, where an empty-net OT goal costs the team its OT point and is
//    charged as a regulation loss (MIN vs VGK, 2024-03-30).
// 3. Shutouts credited on the goalie's own goals_against = 0, which also
//    matched relief appearances and shared-net games (~1,600 rows). A
//    shutout requires the goalie to play the whole game alone with the
//    opponent's final score at 0 — the same rule the backfill now uses.
//
// Steps, each reported in the dry run:
//   a. Team-games with no decision at all: a lone goalie who lost a
//      regular-season OT/SO game is the goalie of record by rule (OTL, no
//      API call); anything else is re-fetched from the boxscore.
//   b. Any OTL on a playoff game becomes L.
//   c. Reconcile: for every team-season whose goalie W-L-OTL still doesn't
//      match its official standings row, re-fetch that team's OT/SO-loss
//      boxscores and apply the API's own decision code. Catches the rare
//      rule-based exceptions (like the pulled-goalie case) generically.
//   d. Shutout flags recomputed from the rule above.
//
// Afterwards run scripts/verify-team.ts for each team — its goalie-record
// and shutout invariants are the independent check that this worked.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/repair-goalie-decisions.ts          (dry run)
//   npx tsx --env-file=.env.local scripts/repair-goalie-decisions.ts --apply

import { Client } from "pg";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const API = "https://api-web.nhle.com/v1";
const CACHE_PATH = "scratch/goalie-decision-boxscores.json";
const APPLY = process.argv.includes("--apply");

async function fetchJson<T>(url: string, retries = 6): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json() as Promise<T>;
    if (res.status === 429 && attempt < retries) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    throw new Error(`${res.status} fetching ${url}`);
  }
  throw new Error("Unreachable");
}

// Must match scripts/backfill-season.ts exactly: the API's codes are
// authoritative ("O" = OT/SO loss, "L" = loss, even in overtime).
function mapDecision(apiDecision: string | undefined, isPlayoff: boolean): string | null {
  if (apiDecision === "W") return "W";
  if (apiDecision === "O") return isPlayoff ? "L" : "OTL";
  if (apiDecision === "L") return "L";
  return null;
}

type BoxGoalie = { playerId: number; decision?: string };
type Boxscore = {
  id: number;
  gameOutcome?: { lastPeriodType?: string };
  homeTeam: { id: number };
  playerByGameStats?: Record<"homeTeam" | "awayTeam", { goalies: BoxGoalie[] }>;
};

// Sequential with a small gap: a first run at 8 parallel requests drew
// 429s from the NHL API within the first batch. Fetched boxscores (just
// the fields used here) are cached in scratch/ so --apply after a dry run
// doesn't re-fetch ~700 games, and an interrupted run resumes.
mkdirSync(dirname(CACHE_PATH), { recursive: true });
const cache: Record<string, Boxscore> = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, "utf8")) : {};
let fetchedSinceSave = 0;

async function getBox(gameId: string): Promise<Boxscore> {
  if (cache[gameId]) return cache[gameId];
  const full = await fetchJson<Boxscore>(`${API}/gamecenter/${gameId}/boxscore`);
  const goaliesOf = (side: "homeTeam" | "awayTeam") => ({
    goalies: (full.playerByGameStats?.[side]?.goalies ?? []).map((p) => ({ playerId: p.playerId, decision: p.decision })),
  });
  cache[gameId] = {
    id: full.id,
    gameOutcome: full.gameOutcome,
    homeTeam: { id: full.homeTeam.id },
    playerByGameStats: { homeTeam: goaliesOf("homeTeam"), awayTeam: goaliesOf("awayTeam") },
  };
  if (++fetchedSinceSave % 25 === 0) writeFileSync(CACHE_PATH, JSON.stringify(cache));
  await new Promise((r) => setTimeout(r, 250));
  return cache[gameId];
}

function apiGoalies(box: Boxscore, teamId: number, isPlayoff: boolean) {
  const side = box.homeTeam.id === teamId ? "homeTeam" : "awayTeam";
  return (box.playerByGameStats?.[side]?.goalies ?? []).map((p) => ({
    player_id: p.playerId,
    decision: mapDecision(p.decision, isPlayoff),
  }));
}

type Update = { game_id: string; player_id: number; decision: string; step: string };

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log(APPLY ? "=== APPLY MODE — writing changes ===" : "=== DRY RUN — no writes (pass --apply) ===");
  const updates: Update[] = [];
  const unresolved: string[] = [];

  // --- a. Missing decisions ------------------------------------------------
  const { rows: rawMissing } = await client.query(
    `select ggs.game_id, ggs.team_id, g.game_end_type, g.game_type,
            (case when ggs.team_id = g.home_team_id then g.home_score > g.away_score
                  else g.away_score > g.home_score end) as team_won,
            array_agg(ggs.player_id order by ggs.player_id) as goalie_ids
     from goalie_game_stats ggs
     join games g on g.id = ggs.game_id
     group by ggs.game_id, ggs.team_id, g.game_end_type, g.game_type, g.home_team_id, g.home_score, g.away_score
     having count(ggs.decision) = 0`,
  );
  // pg returns bigint columns as strings — normalize so id comparisons
  // against the API's numeric ids can't silently miss.
  const missing = rawMissing.map((m) => ({
    game_id: String(m.game_id),
    team_id: Number(m.team_id),
    game_end_type: m.game_end_type as string,
    isPlayoff: m.game_type === "playoff",
    team_won: m.team_won as boolean,
    goalie_ids: (m.goalie_ids as unknown[]).map(Number),
  }));
  // A team that used one goalie: he is the goalie of record, so his
  // decision is the team's result. (One real case needs this even with the
  // API in hand: PHI 2018-02-08, a shootout win whose boxscore omits the
  // winning goalie's decision.)
  const lonGoalieDecision = (m: (typeof missing)[number]) =>
    m.team_won ? "W" : !m.isPlayoff && m.game_end_type !== "regulation" ? "OTL" : "L";
  const byRule = missing.filter((m) => m.goalie_ids.length === 1);
  const needApi = missing.filter((m) => !byRule.includes(m));
  console.log(`a. Team-games with no goalie decision: ${missing.length}`);
  console.log(`   by rule (lone goalie gets the team's result): ${byRule.length}`);
  console.log(`   via boxscore: ${needApi.length}`);
  for (const m of byRule) updates.push({ game_id: m.game_id, player_id: m.goalie_ids[0], decision: lonGoalieDecision(m), step: "a" });
  for (let i = 0; i < needApi.length; i++) {
    const tg = needApi[i];
    const decided = apiGoalies(await getBox(tg.game_id), tg.team_id, tg.isPlayoff).filter(
      (p): p is { player_id: number; decision: string } => p.decision !== null && tg.goalie_ids.includes(p.player_id),
    );
    if (decided.length !== 1) unresolved.push(`${tg.game_id} team ${tg.team_id}: API gave ${decided.length} decisions`);
    else updates.push({ game_id: tg.game_id, ...decided[0], step: "a" });
    if ((i + 1) % 100 === 0) console.log(`   ${i + 1}/${needApi.length} boxscores`);
  }

  // --- b. Playoff OTL → L --------------------------------------------------
  const { rows: playoffOtl } = await client.query(
    `select ggs.game_id, ggs.player_id from goalie_game_stats ggs join games g on g.id = ggs.game_id
     where g.game_type = 'playoff' and ggs.decision = 'OTL'`,
  );
  console.log(`b. Playoff rows stored as OTL (should be L): ${playoffOtl.length}`);
  for (const r of playoffOtl) updates.push({ game_id: String(r.game_id), player_id: Number(r.player_id), decision: "L", step: "b" });

  // --- c. Reconcile against official standings ----------------------------
  // Compares what the goalie records will be AFTER steps a and b (pending
  // updates applied in memory), so a dry run reports the true remainder.
  const pending = new Map(updates.map((u) => [`${u.game_id}:${u.player_id}`, u.decision]));
  const { rows: regRows } = await client.query(
    `select ggs.game_id, ggs.player_id, ggs.team_id, ggs.decision, g.season_id, g.game_end_type,
            (case when ggs.team_id = g.home_team_id then g.home_score > g.away_score
                  else g.away_score > g.home_score end) as team_won
     from goalie_game_stats ggs join games g on g.id = ggs.game_id
     where g.game_type = 'regular'`,
  );
  const { rows: standings } = await client.query(
    `select ss.team_id, ss.season_id, ss.wins, ss.losses, ss.ot_losses, ss.games_played,
            (select count(*) from games g where g.season_id = ss.season_id and g.game_type = 'regular'
               and (g.home_team_id = ss.team_id or g.away_team_id = ss.team_id)) as loaded_games
     from standings_snapshots ss`,
  );
  const record = new Map<string, { W: number; L: number; OTL: number }>();
  for (const r of regRows) {
    const key = `${r.team_id}:${r.season_id}`;
    const decision = pending.get(`${r.game_id}:${r.player_id}`) ?? r.decision;
    const rec = record.get(key) ?? { W: 0, L: 0, OTL: 0 };
    if (decision === "W" || decision === "L" || decision === "OTL") rec[decision as "W" | "L" | "OTL"]++;
    record.set(key, rec);
  }
  const mismatched = standings.filter((s) => {
    if (Number(s.games_played) !== Number(s.loaded_games)) return false; // snapshot not final yet
    const rec = record.get(`${s.team_id}:${s.season_id}`) ?? { W: 0, L: 0, OTL: 0 };
    return rec.W !== Number(s.wins) || rec.L !== Number(s.losses) || rec.OTL !== Number(s.ot_losses);
  });
  console.log(`c. Team-seasons still not reconciling with standings: ${mismatched.length}`);
  for (const s of mismatched) {
    const otGames = regRows.filter(
      (r) => r.team_id === s.team_id && r.season_id === s.season_id && !r.team_won && r.game_end_type !== "regulation",
    );
    for (const r of otGames) {
      const api = apiGoalies(await getBox(String(r.game_id)), Number(r.team_id), false).find((p) => p.player_id === Number(r.player_id));
      const current = pending.get(`${r.game_id}:${r.player_id}`) ?? r.decision;
      if (api?.decision && api.decision !== current) {
        updates.push({ game_id: String(r.game_id), player_id: Number(r.player_id), decision: api.decision, step: "c" });
        console.log(`   ${r.game_id} player ${r.player_id}: ${current ?? "null"} → ${api.decision} (per API)`);
      }
    }
  }
  writeFileSync(CACHE_PATH, JSON.stringify(cache));

  const tally = updates.reduce<Record<string, number>>((acc, u) => ((acc[`${u.step}:${u.decision}`] = (acc[`${u.step}:${u.decision}`] ?? 0) + 1), acc), {});
  console.log(`Decisions to set: ${updates.length}`, tally);
  if (unresolved.length) console.log(`Unresolved (left untouched): ${unresolved.length}\n  ${unresolved.join("\n  ")}`);

  // --- d. Shutouts ---------------------------------------------------------
  const shutoutRule = `
    with rule as (
      select ggs.game_id, ggs.player_id,
             (count(*) over (partition by ggs.game_id, ggs.team_id) = 1
              and (case when ggs.team_id = g.home_team_id then g.away_score else g.home_score end) = 0) as should_be
      from goalie_game_stats ggs join games g on g.id = ggs.game_id
    )`;
  const { rows: flips } = await client.query(
    `${shutoutRule}
     select count(*) filter (where ggs.shutout and not r.should_be) as remove,
            count(*) filter (where not ggs.shutout and r.should_be) as add
     from goalie_game_stats ggs join rule r using (game_id, player_id)`,
  );
  console.log(`d. Shutout flags to remove: ${flips[0].remove}, to add: ${flips[0].add}`);

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to write.");
    await client.end();
    return;
  }

  await client.query("begin");
  try {
    for (const u of updates) {
      await client.query(
        `update goalie_game_stats set decision = $3, updated_at = now()
         where game_id = $1 and player_id = $2 and decision is distinct from $3`,
        [u.game_id, u.player_id, u.decision],
      );
    }
    const { rowCount } = await client.query(
      `${shutoutRule}
       update goalie_game_stats ggs set shutout = r.should_be, updated_at = now()
       from rule r
       where r.game_id = ggs.game_id and r.player_id = ggs.player_id and ggs.shutout is distinct from r.should_be`,
    );
    await client.query("commit");
    console.log(`Applied ${updates.length} decisions and ${rowCount} shutout corrections.`);
  } catch (err) {
    await client.query("rollback");
    throw err;
  }
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
