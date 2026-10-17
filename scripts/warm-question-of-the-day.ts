// Answers the homepage's question of the day now, by hand (the hourly run
// is /api/cron/warm-qotd on Vercel). Only calls the model when today's
// answer is missing or older than the newest Bruins game.
//
// Usage: npx tsx --env-file=.env.local scripts/warm-question-of-the-day.ts

import { answerQuestionCached } from "../lib/qa-cache";
import { getClubSeason } from "../lib/nhl-schedule";
import { questionOfTheDay, getCachedAnswer, etDate, bruinsDataChangedAt } from "../lib/question-of-the-day";
import { pool } from "../lib/db";

async function main() {
  const now = new Date();
  const club = await getClubSeason("BOS");
  const today = etDate(now);
  const tonight = club?.games.find((g) => etDate(new Date(g.startTimeUTC)) === today) ?? null;
  const question = questionOfTheDay(now, tonight ? { opponentName: tonight.opponentName } : null);
  console.log(`Question of the day (${today}): ${question}`);

  if (await getCachedAnswer(question)) {
    console.log("Already answered and current — nothing to do.");
  } else {
    const result = await answerQuestionCached(question, { maxAgeMs: 0, freshAfter: await bruinsDataChangedAt() });
    console.log(`Answered: ${result.answer.slice(0, 300)}`);
  }
  await pool.end();
}

main().catch(async (err) => {
  console.error("warm-question-of-the-day failed:", err);
  await pool.end().catch(() => {});
  process.exit(1); // a failure says so (it exited 0 for two weeks while failing)
});
