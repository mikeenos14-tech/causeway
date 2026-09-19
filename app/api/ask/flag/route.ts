import { NextRequest, NextResponse } from "next/server";
import { flagQuestion } from "@/lib/qa-log";

export async function POST(req: NextRequest) {
  const { logId, note } = await req.json();

  if (typeof logId !== "number") {
    return NextResponse.json({ error: "Missing logId." }, { status: 400 });
  }
  if (note !== undefined && note !== null && typeof note !== "string") {
    return NextResponse.json({ error: "note must be a string." }, { status: 400 });
  }
  if (typeof note === "string" && note.length > 1000) {
    return NextResponse.json({ error: "Note is too long (1000 characters max)." }, { status: 400 });
  }

  try {
    await flagQuestion(logId, note ?? null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Flag failed:", err);
    return NextResponse.json({ error: "Couldn't submit that right now." }, { status: 500 });
  }
}
