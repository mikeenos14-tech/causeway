// Fills team_game_stats (shots on goal, power play, penalty kill, faceoff
// win%, hits) from the NHL API's right-rail endpoint, which returns both
// teams' box-score-level totals in one call per game — confirmed live
// against a real game before writing this (see the "Score comparison"
// verification below). xg_for/xg_against/corsi_for/corsi_against are left
// null here on purpose: those are a separate MoneyPuck integration, not
// something the NHL API exposes.
//
// Not team-scoped like generate-highlights.ts's significance checks — this
// is pure structured box-score data, no narration, no hallucination risk,
// so it runs across the full league by default the same way backfill-range
// already does for games/skaters/goalies.
//
// Usage: npx tsx scripts/backfill-team-game-stats.ts [gameId ...]
// No args: every game missing a complete pair of team_game_stats rows.

import { Client } from "pg";

const API = "https://api-web.nhle.com/v1";
// Measured live against the real API before trusting any number here: a
// burst of ~250 requests at concurrency 8 (and even at concurrency 3 with
// a 150ms gap) got every request 429'd, and the lockout didn't clear for
// roughly a minute of near-total silence — this is a sustained rate-limit
// window, not a per-request throttle a small delay can dodge. Concurrency
// 2 plus a real gap between batches is deliberately conservative: this
// script has ~24k games to get through either way, so there's no reason
// to push the limit and risk tripping the same lockout again.
const BATCH_SIZE = 2;
const BATCH_DELAY_MS = 400;

async function fetchJson<T>(url: string, timeoutMs = 30000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Timed out after ${timeoutMs}ms fetching ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429) {
    // Confirmed live: once tripped, this doesn't clear in seconds — a
    // short retry would just add to the pile during the lockout window
    // instead of waiting it out. The caller's retry loop (RATE_LIMIT_PATTERN
    // in main()) handles the actual long wait; this just labels the error
    // so that loop can tell a rate limit apart from a real failure.
    throw new Error(`429 rate limited fetching ${url}`);
  }
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return res.json() as Promise<T>;
}

type RightRail = {
  teamGameStats?: { category: string; awayValue: unknown; homeValue: unknown }[];
};

// "X/Y" for a team's own powerPlay entry — X goals scored on Y power-play
// opportunities for that team.
function parseFraction(value: unknown): { made: number; total: number } | null {
  if (typeof value !== "string") return null;
  const m = /^(\d+)\/(\d+)$/.exec(value);
  if (!m) return null;
  return { made: Number(m[1]), total: Number(m[2]) };
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

// Fetch-only — no DB access here. A single pg Client (not a Pool) can't
// safely run overlapping queries; this ran concurrently inside the
// original version's Promise.all and pg logged a deprecation warning for
// it (silently queued correctly in this test, but that's undefined
// behavior to build a 24k-game run on, not a guarantee). Fetching is the
// part worth doing concurrently anyway — the DB writes happen afterward,
// sequentially, in main().
async function fetchGameStats(gameId: number, homeTeamId: number, awayTeamId: number) {
  const rightRail = await fetchJson<RightRail>(`${API}/gamecenter/${gameId}/right-rail`);
  const stats = rightRail.teamGameStats;
  if (!stats || stats.length === 0) {
    throw new Error("no teamGameStats in right-rail response (likely an unplayed or too-old game)");
  }
  const byCategory = new Map(stats.map((s) => [s.category, s]));

  const sog = byCategory.get("sog");
  const faceoffPct = byCategory.get("faceoffWinningPctg");
  const hits = byCategory.get("hits");
  const powerPlay = byCategory.get("powerPlay");

  const homePp = parseFraction(powerPlay?.homeValue);
  const awayPp = parseFraction(powerPlay?.awayValue);

  // A team's penalty kill is the OTHER team's power play: how many times
  // the opponent had a man advantage against them, and how many of those
  // they let in. There's no separate "penalty kill" category in the API
  // because it's the same underlying event counted from the other side.
  return [
    {
      gameId,
      teamId: homeTeamId,
      shotsOnGoal: numOrNull(sog?.homeValue),
      ppGoals: homePp?.made ?? null,
      ppOpportunities: homePp?.total ?? null,
      pkGoalsAgainst: awayPp?.made ?? null,
      pkTimesShorthanded: awayPp?.total ?? null,
      hits: numOrNull(hits?.homeValue),
      faceoffWinPct: numOrNull(faceoffPct?.homeValue),
    },
    {
      gameId,
      teamId: awayTeamId,
      shotsOnGoal: numOrNull(sog?.awayValue),
      ppGoals: awayPp?.made ?? null,
      ppOpportunities: awayPp?.total ?? null,
      pkGoalsAgainst: homePp?.made ?? null,
      pkTimesShorthanded: homePp?.total ?? null,
      hits: numOrNull(hits?.awayValue),
      faceoffWinPct: numOrNull(faceoffPct?.awayValue),
    },
  ];
}

async function writeGameStats(
  client: Client,
  rows: { gameId: number; teamId: number; shotsOnGoal: number | null; ppGoals: number | null; ppOpportunities: number | null; pkGoalsAgainst: number | null; pkTimesShorthanded: number | null; hits: number | null; faceoffWinPct: number | null }[],
) {
  for (const r of rows) {
    await client.query(
      `insert into team_game_stats
         (game_id, team_id, shots_on_goal, pp_goals, pp_opportunities, pk_goals_against, pk_times_shorthanded, hits, faceoff_win_pct, source)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'nhl_api_right_rail')
       on conflict (game_id, team_id) do update set
         shots_on_goal = excluded.shots_on_goal, pp_goals = excluded.pp_goals, pp_opportunities = excluded.pp_opportunities,
         pk_goals_against = excluded.pk_goals_against, pk_times_shorthanded = excluded.pk_times_shorthanded,
         hits = excluded.hits, faceoff_win_pct = excluded.faceoff_win_pct, source = excluded.source, updated_at = now()`,
      [r.gameId, r.teamId, r.shotsOnGoal, r.ppGoals, r.ppOpportunities, r.pkGoalsAgainst, r.pkTimesShorthanded, r.hits, r.faceoffWinPct],
    );
  }
}

async function backfillOnce() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  // pg's Client emits 'error' on the raw connection (e.g. Neon closing an
  // idle/long-lived connection) as an EventEmitter event, not a rejected
  // promise — with no listener attached, Node treats that as fatal and
  // kills the whole process instantly, skipping every try/catch and the
  // CONNECTION_ERROR_PATTERN retry loop below entirely. Confirmed live:
  // this crashed the process outright at 6,202/24,233 games in.
  //
  // A second bug found immediately after fixing that one: once the drop
  // happens, EVERY subsequent client.query() call started rejecting with
  // some other message (not one containing "Connection terminated" or any
  // other CONNECTION_ERROR_PATTERN text), so the per-game catch below kept
  // swallowing them as ordinary failures instead of re-throwing — 348
  // real, fine games got marked "failed" in a row before this was caught.
  // Pattern-matching arbitrary pg error text isn't reliable enough to
  // build a recovery on. This flag is: the client already told us,
  // definitively, that it's broken — check that directly instead of
  // guessing from whatever error message a doomed query happens to throw.
  let connectionDead = false;
  client.on("error", (err) => {
    connectionDead = true;
    console.error(`pg client error (connection dropped): ${err.message}`);
  });
  await client.connect();

  try {

  let gameIds = process.argv.slice(2).map(Number);
  if (gameIds.length === 0) {
    const { rows } = await client.query(
      `select g.id, g.home_team_id, g.away_team_id from games g
       where (select count(*) from team_game_stats tgs where tgs.game_id = g.id) < 2
       order by g.game_date desc`,
    );
    gameIds = rows.map((r) => r.id);
    console.log(`No game IDs given — backfilling ${gameIds.length} games missing team_game_stats.`);
  }

  // team ids aren't in argv, so look them up regardless of how gameIds was populated
  const { rows: gameRows } = await client.query(
    `select id, home_team_id, away_team_id from games where id = any($1::int[])`,
    [gameIds],
  );
  const gameMeta = new Map(gameRows.map((r) => [r.id, { homeTeamId: r.home_team_id, awayTeamId: r.away_team_id }]));

  let done = 0;
  let failed = 0;
  const failures: { gameId: number; error: string }[] = [];

  for (let i = 0; i < gameIds.length; i += BATCH_SIZE) {
    const batch = gameIds.slice(i, i + BATCH_SIZE);

    // Fetch concurrently (network I/O, safe and worth parallelizing).
    let fetched = await Promise.all(
      batch.map(async (gameId) => {
        const meta = gameMeta.get(gameId);
        if (!meta) return { gameId, ok: false as const, error: "game not found in games table" };
        try {
          return { gameId, ok: true as const, rows: await fetchGameStats(gameId, meta.homeTeamId, meta.awayTeamId) };
        } catch (err) {
          return { gameId, ok: false as const, error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );

    // A 429 in this batch means the whole API is in a lockout window right
    // now (confirmed live — it doesn't clear in seconds), so retrying just
    // this batch immediately would only add to it. Wait out a real cooldown
    // and retry the SAME batch instead of recording these as permanent
    // failures — every other in-flight game in the batch gets re-fetched
    // too, which is wasted but harmless (upserts), and far simpler than
    // tracking partial-batch success through a retry.
    for (let rateLimitAttempt = 1; fetched.some((f) => !f.ok && /429/.test(f.error)) && rateLimitAttempt <= 5; rateLimitAttempt++) {
      const cooldownMs = 60000 * rateLimitAttempt;
      console.log(`Rate limited — waiting ${cooldownMs / 1000}s before retrying this batch (attempt ${rateLimitAttempt}/5)...`);
      await new Promise((r) => setTimeout(r, cooldownMs));
      fetched = await Promise.all(
        batch.map(async (gameId) => {
          const meta = gameMeta.get(gameId);
          if (!meta) return { gameId, ok: false as const, error: "game not found in games table" };
          try {
            return { gameId, ok: true as const, rows: await fetchGameStats(gameId, meta.homeTeamId, meta.awayTeamId) };
          } catch (err) {
            return { gameId, ok: false as const, error: err instanceof Error ? err.message : String(err) };
          }
        }),
      );
    }

    // Write sequentially (one pg Client, not a Pool — overlapping queries
    // on it aren't safe; see fetchGameStats's comment).
    for (const f of fetched) {
      // Checked before touching the client at all — see connectionDead's
      // comment above. A regex on the query's own error text isn't
      // reliable enough on its own (confirmed live: it missed a real drop
      // and let 348 fine games get marked "failed" in a row).
      if (connectionDead) throw new Error("Connection terminated unexpectedly (flagged by client error listener)");
      if (!f.ok) {
        failed++;
        failures.push({ gameId: f.gameId, error: f.error });
        continue;
      }
      try {
        await writeGameStats(client, f.rows);
        done++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Same reasoning as generate-highlights.ts: a dead connection would
        // otherwise silently mislabel every remaining write in this run as
        // a per-game failure instead of triggering main()'s reconnect.
        if (connectionDead || CONNECTION_ERROR_PATTERN.test(message)) throw err;
        failed++;
        failures.push({ gameId: f.gameId, error: message });
      }
    }

    if ((i / BATCH_SIZE) % 25 === 0) {
      console.log(`... ${done + failed}/${gameIds.length} processed (${done} ok, ${failed} failed)`);
    }
    await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
  }

  console.log(`\nDone. ${done} game(s) backfilled, ${failed} failed.`);
  if (failures.length > 0) {
    console.log("First 20 failures:");
    for (const f of failures.slice(0, 20)) console.log(`  - ${f.gameId}: ${f.error}`);
  }

  } finally {
    await client.end();
  }
}

// A connection can drop mid-run (this exact machine has done it before,
// mid-backfill, from the laptop sleeping) for reasons unrelated to this
// script's own logic. Retrying the whole run is safe and cheap: every
// write is an upsert, and the "no game IDs given" query only ever selects
// games still missing team_game_stats, so a fresh attempt naturally picks
// up where the dead connection left off instead of redoing finished work.
// A non-connection error is NOT retried — it should surface immediately,
// not loop on something that will never succeed.
const CONNECTION_ERROR_PATTERN = /ECONNRESET|ETIMEDOUT|Connection terminated|connect ECONNREFUSED|EPIPE|Timed out after \d+ms/i;

async function main() {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await backfillOnce();
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isConnectionError = CONNECTION_ERROR_PATTERN.test(message);
      if (!isConnectionError || attempt === maxAttempts) throw err;
      const waitMs = 1000 * 2 ** attempt;
      console.log(`Connection error on attempt ${attempt}/${maxAttempts} (${message}) — retrying in ${waitMs}ms...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
