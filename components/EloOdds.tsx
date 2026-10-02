import type { EloOdds } from "@/lib/elo-odds";
import { ELO } from "@/config/stats";

// Pregame win chances from Elo: a split bar with whole percentages and a
// plain "how this works". The numbers sum to 100 (away is 100 - home).

export function EloOddsBar({ odds, away, home }: { odds: EloOdds; away: { abbrev: string; name: string }; home: { abbrev: string; name: string } }) {
  const h = Math.round(odds.home * 100);
  const a = 100 - h;
  const favored = a > h ? away : h > a ? home : null;
  return (
    <section style={{ marginBottom: "2.25rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.35rem", textTransform: "uppercase", letterSpacing: ".02em", margin: 0 }}>Win Chance</h2>
        <span style={{ fontSize: ".78rem", color: "var(--text-secondary)" }}>{favored ? `${favored.name} favored` : "a coin flip"} · Elo</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-display)", fontSize: "1.6rem", marginBottom: 6 }}>
        <span style={{ color: away.abbrev === "BOS" ? "var(--gold)" : "var(--text-primary)" }}>
          {away.abbrev} {a}%
        </span>
        <span style={{ color: home.abbrev === "BOS" ? "var(--gold)" : "var(--text-primary)" }}>
          {h}% {home.abbrev}
        </span>
      </div>
      <div role="img" aria-label={`${away.name} ${a} percent, ${home.name} ${h} percent`} style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden", background: "var(--border)" }}>
        <div style={{ width: `${a}%`, background: away.abbrev === "BOS" ? "var(--gold)" : "var(--text-secondary)" }} />
        <div style={{ width: `${h}%`, background: home.abbrev === "BOS" ? "var(--gold)" : "var(--surface-2)", borderLeft: "2px solid var(--bg)" }} />
      </div>
      <details style={{ marginTop: 10, fontSize: ".8rem", color: "var(--text-secondary)" }}>
        <summary style={{ cursor: "pointer", color: "var(--gold)" }}>How this works</summary>
        <p style={{ margin: ".5rem 0 0", maxWidth: "70ch", lineHeight: 1.5 }}>
          Each team has an Elo rating built from every NHL game since 1917 (wins, margins, home ice), updated after each game. The ratings&apos; gap,
          plus home ice, gives each team&apos;s chance to win, overtime and shootouts included. Tested on {ELO.winProb.heldOutGames.toLocaleString()} games
          from seasons the model never saw, it beat a no-information guess every season and was typically within about {Math.round(ELO.winProb.calibrationErrorPts)}{" "}
          points of how often teams actually won. It doesn&apos;t know about injuries or who&apos;s in goal. Ratings: {away.abbrev}{" "}
          {Math.round(odds.awayRating)}, {home.abbrev} {Math.round(odds.homeRating)}.
        </p>
      </details>
    </section>
  );
}
