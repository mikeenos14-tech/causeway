import { AskClient } from "./AskClient";

// /ask?q=... (from a suggested question on a game page or the homepage)
// opens with that question already asked.
export default async function Ask({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { q } = await searchParams;
  return <AskClient initialQuestion={typeof q === "string" ? q.slice(0, 500) : ""} />;
}
