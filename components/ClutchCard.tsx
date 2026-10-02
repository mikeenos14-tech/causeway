import Link from "next/link";
import type { ClutchCard as Card, BigGoal } from "@/lib/leverage-data";
import { formatWpa } from "@/lib/wp-curve";
import { formatGameDate } from "@/lib/format-date";
import { periodName } from "@/components/ScoringSummary";

// A player's Leverage Goals (lib/leverage-data.ts): what his goals did to
// his team's chance of winning, career totals and his biggest goals.
//
// Framed as "wins added", not "clutch": per-goal value also reflects his
// team (goals for a dominant team often come with the game decided), so
// the card says so rather than ranking anyone as unclutch.

const LABEL = { fontSize: ".72rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase" as const, letterSpacing: ".05em" };
const VALUE = { fontFamily: "var(--font-display)", fontSize: "1.6rem", fontWeight: 600, lineHeight: 1.1 };
const NOTE = { fontSize: ".78rem", color: "var(--text-secondary)" };

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const ordinal = (n: number) => {
  const v = n % 100;
  return `${n}${v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};

export function goalContext(g: BigGoal) {
  return `${g.playoff ? "Playoffs · " : ""}${formatGameDate(g.date, true)} vs ${g.opponent} · ${periodName(g.period, g.periodType)} ${clock(g.timeInPeriod)}`;
}

export function ClutchCard({ c, name }: { c: Card; name: string }) {
  const r = c.regular;
  const last = name.split(" ").slice(1).join(" ") || name;
  return (
    <section style={{ marginBottom: "2.5rem" }} aria-labelledby="clutch-heading">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: ".9rem" }}>
        <h2 id="clutch-heading" style={{ fontFamily: "var(--font-display)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".02em", fontSize: "1.4rem", margin: 0 }}>
          Goals That Moved Games
        </h2>
        <Link href="/history/leverage" style={{ fontSize: ".82rem", color: "var(--gold)", textDecoration: "none" }}>
          Leaderboards →
        </Link>
      </div>
      <div className="clutch-grid">
        {r && (
          <div>
            <span style={LABEL}>Wins added by his goals</span>
            <span style={{ ...VALUE, display: "block" }}>{r.lg.toFixed(1)}</span>
            <span style={NOTE}>{r.goals} regular-season goals</span>
          </div>
        )}
        {r && (
          <div>
            <span style={LABEL}>Average goal</span>
            <span style={{ ...VALUE, display: "block" }}>{formatWpa(r.perGoal)}</span>
            <span style={NOTE}>
              win chance added
              {r.index != null && Math.round(100 * (r.index - 1)) !== 0
                ? ` · ${Math.abs(Math.round(100 * (r.index - 1)))}% ${r.index > 1 ? "above" : "below"} the league average for his seasons`
                : r.index != null
                  ? " · the league average for his seasons"
                  : ""}
              {c.percentile != null ? ` (${ordinal(Math.round(100 * c.percentile))} percentile of ${c.rankedAmong.toLocaleString()} 100-goal scorers)` : ""}
            </span>
          </div>
        )}
        {r && (
          <div>
            <span style={LABEL}>Decided-game goals</span>
            <span style={{ ...VALUE, display: "block" }}>{Math.round(100 * r.garbagePct)}%</span>
            <span style={NOTE}>moved the win chance under 2 points</span>
          </div>
        )}
        {c.playoff && (
          <div>
            <span style={LABEL}>Playoffs</span>
            <span style={{ ...VALUE, display: "block" }}>{c.playoff.lg.toFixed(1)}</span>
            <span style={NOTE}>
              wins added, {c.playoff.goals} goals{c.playoff.playoffLg > 0 ? ` · ${c.playoff.playoffLg.toFixed(2)} series added` : ""}
            </span>
          </div>
        )}
      </div>

      {c.bestGoals.length > 0 && (
        <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, padding: ".9rem 1.2rem", marginTop: "1.1rem" }}>
          <div style={{ ...LABEL, marginBottom: 4 }}>{last}&rsquo;s biggest goals</div>
          <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {c.bestGoals.map((g, i) => (
              <li key={`${g.gameId}-${i}`} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, padding: "8px 0", borderTop: i ? "1px solid var(--border)" : "none", fontSize: ".86rem" }}>
                <span>
                  <Link href={`/games/${g.gameId}`} style={{ color: "var(--text-primary)", textDecoration: "none", fontWeight: 600 }}>
                    {g.scoreAfter}
                  </Link>
                  <span style={{ display: "block", ...NOTE }}>{goalContext(g)}</span>
                </span>
                <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  <span style={{ fontWeight: 700, color: "var(--gold)" }}>{formatWpa(g.wpa)}</span>
                  <span style={{ display: "block", ...NOTE }}>
                    {Math.round(100 * g.before)}% → {Math.round(100 * g.after)}%
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <details className="wp-how">
        <summary>How this works</summary>
        <p>
          Every goal is worth what it did to its team&rsquo;s chance of winning, from just before it to just after, using the site&rsquo;s win probability
          model. A tying goal in the last minute can be worth 40 points or more; the fifth goal of a 6-1 game, almost nothing. Added up, a player&rsquo;s goals
          come to a number of wins: every 100 points of win chance added is one win.
        </p>
        <p>
          Per goal compares him with the league average for the seasons he played, so different scoring eras are fair. It also reflects his team: goals for a
          dominant team often come with the game already decided, so great scorers on great teams can rank low per goal without being any less clutch.
        </p>
        <p>
          In the playoffs, &ldquo;series added&rdquo; also weighs each goal by how much its game mattered to the series (a Game 7 counts fully; a game
          in a series nearly won, very little). Every goal since 1917 is counted, from the NHL&rsquo;s own game records.
        </p>
      </details>
    </section>
  );
}
