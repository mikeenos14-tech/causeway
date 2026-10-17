import { NextResponse } from "next/server";
import { answerQuestionCached } from "@/lib/qa-cache";
import { getClubSeason } from "@/lib/nhl-schedule";
import { questionOfTheDay, getCachedAnswer, etDate, bruinsDataChangedAt } from "@/lib/question-of-the-day";
import { recordHeartbeat } from "@/lib/load-game";

// Hourly (vercel.json): answers the homepage's question of the day ahead
// of time. Calls the model only when today's answer is missing or older
// than the newest Bruins game, about once a day. Here rather than in the
// GitHub job because Vercel has Ask's read-only database login.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const now = new Date();
  const today = etDate(now);
  try {
    const club = await getClubSeason("BOS");
    const tonight = club?.games.find((g) => etDate(new Date(g.startTimeUTC)) === today) ?? null;
    const question = questionOfTheDay(now, tonight ? { opponentName: tonight.opponentName } : null);
    if (await getCachedAnswer(question)) {
      await recordHeartbeat("question-of-the-day", true, `already answered: ${question}`);
      return NextResponse.json({ question, status: "already answered" });
    }
    const result = await answerQuestionCached(question, { maxAgeMs: 0, freshAfter: await bruinsDataChangedAt() });
    await recordHeartbeat("question-of-the-day", true, question);
    return NextResponse.json({ question, status: "answered", answer: result.answer.slice(0, 300) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordHeartbeat("question-of-the-day", false, msg).catch(() => {});
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
