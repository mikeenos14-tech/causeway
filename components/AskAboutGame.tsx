import Link from "next/link";

// Suggested Ask questions under a Bruins game or preview: the natural
// follow-ups ("how do they do against this team?") as one-tap links that
// open /ask with the question already asked. Built only from names on the
// page, so every question is one the database can answer.
export function gameQuestions({ opponent, skater, goalie }: { opponent: string; skater?: string | null; goalie?: string | null }): string[] {
  const qs = [`What's the Bruins' regular-season record against the ${opponent} since 2007-08?`];
  if (skater) qs.push(`How has ${skater} done against the ${opponent} in his career?`);
  if (goalie) qs.push(`What's ${goalie}'s career record and save percentage against the ${opponent}?`);
  return qs;
}

export function AskAboutGame({ title, questions }: { title: string; questions: string[] }) {
  if (questions.length === 0) return null;
  return (
    <div style={{ marginTop: "1.5rem" }}>
      <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--gold)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8 }}>{title}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {questions.map((q) => (
          <Link
            key={q}
            href={`/ask?q=${encodeURIComponent(q)}`}
            style={{ fontSize: ".85rem", color: "var(--text-primary)", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 999, padding: "8px 14px", textDecoration: "none", lineHeight: 1.3 }}
          >
            {q} <span style={{ color: "var(--gold)" }}>→</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
