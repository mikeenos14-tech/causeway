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

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let gameIds = process.argv.slice(2).map(Number);
  if (gameIds.length === 0) {
    // No explicit IDs — process every loaded game with no narrative of
    // EITHER kind yet, now that a "nothing notable" game gets a real
    // 'recap' row instead of being left with nothing (previously this
    // checked only 'highlights', since a quiet game never got a row at
    // all — that's no longer true, so re-running this with no args won't
    // re-process a game that already has its recap stored).
    const { rows } = await client.query(
      `select g.id from games g
       left join narratives n on n.game_id = g.id
       where n.game_id is null
       order by g.game_date asc`,
    );
    gameIds = rows.map((r) => r.id);
    console.log(`No game IDs given — checking all ${gameIds.length} games without a stored narrative.`);
  }

  const failures: { gameId: number; error: string }[] = [];

  for (const gameId of gameIds) {
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
      // A failed or rejected narration for one game must not take down the
      // rest of an unattended batch — log it and keep going. Nothing gets
      // stored for this game, which is the correct outcome for a rejected
      // (contradictory) narration: no highlight beats a wrong one.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`FAILED game ${gameId}: ${message}`);
      failures.push({ gameId, error: message });
    }
  }

  await client.end();

  console.log(`\nDone. ${failures.length} game(s) failed and were skipped.`);
  for (const f of failures) console.log(`  - ${f.gameId}: ${f.error}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
