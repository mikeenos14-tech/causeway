// Full pipeline for one game: run the significance checks, then write one
// recap from the game's verified fact sheet with any notable facts woven
// in (lib/narrate-recap.ts). Every game ends up with exactly one stored
// narrative: 'highlights' when it carries notable facts, 'recap' when not.

import { Client } from "pg";
import { runSignificanceChecks } from "../lib/significance-checks";
import { narrateRecap } from "../lib/narrate-recap";
import { buildGameFacts } from "../lib/game-facts";
import { TARGET_TEAM_ABBREV } from "../lib/significance-checks";

async function backfillOnce(candidateGameIds: number[]) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  // See backfill-team-game-stats.ts's identical comment (that file hit
  // both bugs live, in order): pg's Client emits 'error' on the raw
  // connection as an EventEmitter event, and with no listener that
  // crashes the whole process instantly. Attaching a listener alone isn't
  // enough either — whatever a query throws AFTER the drop doesn't
  // reliably contain any of CONNECTION_ERROR_PATTERN's text, so a
  // catch-and-check-the-message approach can silently swallow a dead
  // connection as hundreds of ordinary per-game failures. connectionDead
  // is the definitive signal instead: the client already told us it's
  // broken, so check that directly rather than re-deriving it from
  // whatever error text a doomed query happens to produce.
  let connectionDead = false;
  client.on("error", (err) => {
    connectionDead = true;
    console.error(`pg client error (connection dropped): ${err.message}`);
  });
  await client.connect();

  try {

  // Re-check which of the candidate games still lack a narrative right
  // before this attempt — on a retry after a dropped connection, this is
  // what makes the retry resume instead of re-spending API calls on
  // everything the first attempt already finished.
  const { rows } = await client.query(
    `select g.id from games g
     left join narratives n on n.game_id = g.id
     where g.id = any($1::int[]) and n.game_id is null`,
    [candidateGameIds],
  );
  const gameIds = rows.map((r) => r.id);
  console.log(`${gameIds.length} of ${candidateGameIds.length} candidate games still need a narrative.`);

  const failures: { gameId: number; error: string }[] = [];

  for (const gameId of gameIds) {
    // See connectionDead's comment above — checked before every game, not
    // inferred from whatever error text a doomed query happens to throw.
    if (connectionDead) throw new Error("Connection terminated unexpectedly (flagged by client error listener)");
    console.log(`\n=== game ${gameId} ===`);
    try {
      const facts = await runSignificanceChecks(client, gameId);

      // One path for every game (2026-10-01): the full recap from the
      // verified fact sheet, with any notable facts woven in. Previously a
      // notable fact REPLACED the recap — the 2026-27 opener, a 3-0
      // shutout, got two sentences about a meeting count and no scorers.
      // Stored as 'highlights' when it carries notable facts (pages show
      // those as "what stood out"), 'recap' otherwise.
      const sheet = await buildGameFacts(client, gameId, TARGET_TEAM_ABBREV);
      if (!sheet) throw new Error(`No game row for ${gameId}`);
      if (facts.length) {
        console.log(`${facts.length} notable fact(s):`);
        for (const f of facts) console.log(`  - ${f.fact}`);
      } else {
        console.log("nothing notable — plain recap");
      }
      const result = await narrateRecap(sheet, facts);
      console.log(`\nHEADLINE: ${result.headline}`);
      console.log(`BODY: ${result.body}`);
      const kind = facts.length ? "highlights" : "recap";
      await client.query(
        `insert into narratives (game_id, kind, headline, body, facts_json, source, model_version)
         values ($1, $2, $3, $4, $5, 'ai_generated', $6)
         on conflict (game_id, kind) do update set
           headline = excluded.headline, body = excluded.body, facts_json = excluded.facts_json,
           model_version = excluded.model_version, generated_at = now()`,
        [gameId, kind, result.headline, result.body, facts.length ? JSON.stringify(facts) : null, result.modelVersion],
      );
      // A game has one narrative: drop the other kind if an earlier run
      // stored it (e.g. regenerated after a fact was added or removed).
      await client.query(`delete from narratives where game_id = $1 and kind in ('highlights', 'recap') and kind <> $2`, [gameId, kind]);
      console.log("(stored)");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A dead connection must NOT be recorded as this game's failure and
      // shrugged off — every query after the drop would fail the same way,
      // silently mislabeling the rest of the batch as "bad narrations"
      // instead of "the connection died." Let it propagate to main()'s
      // retry loop, which reconnects and re-checks what's still missing.
      if (connectionDead || CONNECTION_ERROR_PATTERN.test(message)) throw err;
      // A failed or rejected narration for one game must not take down the
      // rest of an unattended batch — log it and keep going. No narrative
      // row is the correct outcome for a rejected (contradictory)
      // narration: no highlight beats a wrong one. But a 'rejected'
      // marker still gets stored (distinct from 'highlights'/'recap',
      // never read by any page) — otherwise this game has no narratives
      // row at all, looks identical to "never attempted" to the "no game
      // IDs given" query below, and gets retried every single run
      // forever. Confirmed live: the same ~31 games, same deterministic
      // rejection (the game's facts don't change), retried on every
      // hourly cron run — real, recurring cost for something that will
      // never succeed differently.
      console.error(`FAILED game ${gameId}: ${message}`);
      failures.push({ gameId, error: message });
      try {
        await client.query(
          `insert into narratives (game_id, kind, headline, body, source)
           values ($1, 'rejected', null, $2, 'ai_generated')
           on conflict (game_id, kind) do update set body = excluded.body, generated_at = now()`,
          [gameId, message.slice(0, 2000)],
        );
      } catch (markErr) {
        console.error(`  (also failed to record the rejection marker for ${gameId}: ${markErr instanceof Error ? markErr.message : markErr})`);
      }
    }
  }

  console.log(`\nDone. ${failures.length} game(s) failed and were skipped.`);
  for (const f of failures) console.log(`  - ${f.gameId}: ${f.error}`);

  } finally {
    await client.end();
  }
}

// See backfill-team-game-stats.ts's identical pattern/comment: a dropped
// connection is unrelated to this script's own logic, retrying is safe
// (every write is an upsert, and backfillOnce re-checks what's still
// missing before each attempt), and a non-connection error should surface
// immediately rather than loop on something that will never succeed.
const CONNECTION_ERROR_PATTERN = /ECONNRESET|ETIMEDOUT|Connection terminated|connect ECONNREFUSED|EPIPE|Timed out after \d+ms/i;

// Unattended (hourly) runs narrate at most this many games, newest first.
// A normal night has 1-2 new games; a backlog (e.g. every recap cleared for
// a regeneration) once made an hourly run try ~1,000 narrations, exceed the
// job's 30-minute limit, and get cancelled — taking the verify step with
// it. Newest-first means tonight's game is never stuck behind old ones.
const MAX_PER_RUN = Number(process.env.NARRATE_MAX_PER_RUN ?? 25);

async function main() {
  let candidateGameIds = process.argv.slice(2).map(Number);
  if (candidateGameIds.length === 0) {
    // No explicit IDs — every loaded game for TARGET_TEAM_ABBREV with no
    // narrative of either kind yet. Team-scoped deliberately: an earlier
    // version of this query had no team filter at all and started
    // narrating random non-Bruins games in the Bruins voice the moment it
    // ran unattended — caught only after one bad row landed in the shared
    // database. narrateHighlights/narrateRecap assume the Bruins are one
    // of the two teams; this is what actually guarantees that, not a
    // convention someone has to remember to uphold by hand.
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query(
        `select g.id from games g
         join teams ht on ht.id = g.home_team_id
         join teams at on at.id = g.away_team_id
         left join narratives n on n.game_id = g.id
         where (ht.abbrev = $1 or at.abbrev = $1) and n.game_id is null
         order by g.game_date desc
         limit $2`,
        [TARGET_TEAM_ABBREV, MAX_PER_RUN],
      );
      candidateGameIds = rows.map((r) => r.id);
      console.log(`No game IDs given — narrating the ${candidateGameIds.length} newest ${TARGET_TEAM_ABBREV} games without a stored narrative (max ${MAX_PER_RUN} per run).`);
    } finally {
      await client.end();
    }
  }

  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await backfillOnce(candidateGameIds);
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
