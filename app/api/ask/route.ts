import { NextRequest, NextResponse } from "next/server";
import { answerQuestionCached } from "@/lib/qa-cache";
import { QAStepLimitError } from "@/lib/qa-engine";
import { logQuestion, logQuestionError } from "@/lib/qa-log";

export async function POST(req: NextRequest) {
  const { question } = await req.json();

  if (typeof question !== "string" || question.trim().length === 0) {
    return NextResponse.json({ error: "A question is required." }, { status: 400 });
  }
  if (question.length > 500) {
    return NextResponse.json({ error: "Question is too long (500 characters max)." }, { status: 400 });
  }

  const trimmed = question.trim();
  try {
    const result = await answerQuestionCached(trimmed);
    const logId = await logQuestion(trimmed, result);
    return NextResponse.json({ ...result, logId });
  } catch (err) {
    console.error("Q&A engine error:", err);
    await logQuestionError(trimmed, err);
    // A step-limit failure is a real, specific signal (not a generic
    // crash): the question needed more back-and-forth with the database
    // than the budget allows, usually because it's actually several
    // questions bundled into one, or too open-ended to resolve in a
    // bounded number of queries. Worth telling the user that specifically
    // instead of the generic "something went wrong" — it's actionable.
    const message =
      err instanceof QAStepLimitError
        ? "That question has too many moving parts for me to untangle in one go — try narrowing it to one player, team, or season, or splitting it into two separate questions."
        : "Something went wrong answering that question. Try rephrasing it.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
