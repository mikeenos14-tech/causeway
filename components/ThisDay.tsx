import Link from "next/link";
import { getThisDay } from "@/lib/this-day";
import { TeamLogo } from "@/components/TeamLogo";
import { formatGameDate } from "@/lib/format-date";

// "This day in Bruins history" (home page): the most notable Bruins game
// on today's date, plus a few more from the same date. Hidden on dates the
// Bruins have never played (most of July and August).

const H2 = { margin: 0, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.5rem", textTransform: "uppercase" as const, letterSpacing: ".02em" };

export async function ThisDay() {
  const games = await getThisDay(new Date());
  if (games.length === 0) return null;
  const [top, ...rest] = games;
  const result = (g: (typeof games)[number]) => {
    const r = g.team > g.opp ? "W" : g.team < g.opp ? "L" : "T";
    const end = g.finalState === "OT" ? (g.otPeriods > 1 ? ` ${g.otPeriods}OT` : " OT") : g.finalState === "SO" ? " SO" : "";
    return { r, text: `${r} ${g.team}-${g.opp}${end}`, color: r === "W" ? "var(--win)" : r === "L" ? "var(--loss)" : "var(--text-secondary)" };
  };
  const ago = (n: number) => (n === 1 ? "1 year ago today" : `${n} years ago today`);
  const tr = result(top);
  return (
    <section style={{ marginBottom: "2.5rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: "1rem" }}>
        <h2 style={H2}>This Day in Bruins History</h2>
        <Link href="/history" style={{ fontSize: ".78rem", color: "var(--gold)", textDecoration: "none", fontWeight: 600 }}>
          Bruins history →
        </Link>
      </div>
      <Link href={`/games/${top.id}`} style={{ display: "block", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.1rem 1.25rem", textDecoration: "none", color: "inherit" }}>
        <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--gold)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>
          {formatGameDate(top.date, true)} · {ago(top.yearsAgo)}
        </div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: "1.45rem", lineHeight: 1.05, textTransform: "uppercase", marginBottom: top.story ? 6 : 8 }}>{top.headline}</div>
        {top.story && <p style={{ fontFamily: "var(--font-editorial)", fontStyle: "italic", color: "var(--text-secondary)", margin: "0 0 8px", lineHeight: 1.45 }}>{top.story}</p>}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: ".85rem", color: "var(--text-secondary)" }}>
          <span>
            {top.isHome ? "vs" : "@"} <TeamLogo abbrev={top.opponent} size={18} gap={3} />
            {top.opponent} · <strong style={{ color: tr.color }}>{tr.text}</strong>
          </span>
          {top.facts.map((f) => (
            <span key={f} style={{ fontSize: ".75rem", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 9px" }}>
              {f}
            </span>
          ))}
        </div>
      </Link>
      {rest.length > 0 && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".06em" }}>Also on this date</span>
          {rest.slice(0, 3).map((g) => {
            const r = result(g);
            return (
              <Link key={g.id} href={`/games/${g.id}`} style={{ fontSize: ".85rem", color: "var(--text-secondary)", textDecoration: "none" }}>
                {g.date.slice(0, 4)} · {g.isHome ? "vs" : "@"} {g.opponent} · <span style={{ color: r.color, fontWeight: 700 }}>{r.text}</span>
                {g.facts.length > 0 && <span style={{ color: "var(--text-muted)" }}> · {g.facts.join(" · ")}</span>}
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
