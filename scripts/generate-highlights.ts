// Full pipeline for one game: run the significance checks. If something
// real was found, narrate it as a fact-grounded highlight. If not — which
// is most games, in practice — fall back to a shorter, differently-grounded
// "recap" line instead of leaving the game with no voice at all (see
// lib/narrate-recap.ts for why that's a separate function with its own
// rules, not a relaxed version of the highlights prompt). Every game ends
// up with exactly one stored narrative, 'highlights' or 'recap'.

import { Client } from "pg";
import { runSignificanceChecks } from "../lib/significance-checks";
import { narrateHighlights } from "../lib/narrate-highlights";
import { narrateRecap } from "../lib/narrate-recap";
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

      const { rows } = await client.query(
        `select g.game_date, g.game_type, ht.abbrev as home_abbrev, at.abbrev as away_abbrev, g.home_score, g.away_score
         from games g join teams ht on ht.id=g.home_team_id join teams at on at.id=g.away_team_id
         where g.id = $1`,
        [gameId],
      );
      const game = rows[0];

      if (facts.length === 0) {
        console.log("nothing notable — falling back to a recap line (no facts to ground a highlight in)");
        const recap = await narrateRecap({
          homeAbbrev: game.home_abbrev,
          awayAbbrev: game.away_abbrev,
          homeScore: game.home_score,
          awayScore: game.away_score,
          gameDate: game.game_date.toISOString().slice(0, 10),
          gameType: game.game_type,
        });
        console.log(`\nHEADLINE: ${recap.headline}`);
        console.log(`BODY: ${recap.body}`);
        await client.query(
          `insert into narratives (game_id, kind, headline, body, facts_json, source, model_version)
           values ($1, 'recap', $2, $3, null, 'ai_generated', $4)
           on conflict (game_id, kind) do update set
             headline = excluded.headline, body = excluded.body,
             model_version = excluded.model_version, generated_at = now()`,
          [gameId, recap.headline, recap.body, recap.modelVersion],
        );
        console.log("(stored)");
        continue;
      }

      console.log(`${facts.length} fact(s) found:`);
      for (const f of facts) console.log(`  - ${f.fact}`);

      const result = await narrateHighlights(
        {
          homeAbbrev: game.home_abbrev,
          awayAbbrev: game.away_abbrev,
          homeScore: game.home_score,
          awayScore: game.away_score,
          gameDate: game.game_date.toISOString().slice(0, 10),
        },
        facts,
      );

      console.log(`\nHEADLINE: ${result.headline}`);
      console.log(`BODY: ${result.body}`);

      await client.query(
        `insert into narratives (game_id, kind, headline, body, facts_json, source, model_version)
         values ($1, 'highlights', $2, $3, $4, 'ai_generated', $5)
         on conflict (game_id, kind) do update set
           headline = excluded.headline, body = excluded.body, facts_json = excluded.facts_json,
           model_version = excluded.model_version, generated_at = now()`,
        [gameId, result.headline, result.body, JSON.stringify(facts), result.modelVersion],
      );
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
      // rest of an unattended batch — log it and keep going. Nothing gets
      // stored for this game, which is the correct outcome for a rejected
      // (contradictory) narration: no highlight beats a wrong one.
      console.error(`FAILED game ${gameId}: ${message}`);
      failures.push({ gameId, error: message });
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
         order by g.game_date asc`,
        [TARGET_TEAM_ABBREV],
      );
      candidateGameIds = rows.map((r) => r.id);
      console.log(`No game IDs given — checking all ${candidateGameIds.length} ${TARGET_TEAM_ABBREV} games without a stored narrative.`);
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
