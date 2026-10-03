import Link from "next/link";
import type { HistoryGame } from "@/lib/history-data";
import { TeamLogo } from "@/components/TeamLogo";
import { TeamLink } from "@/components/EntityLinks";
import { formatWpa, type GoalWpaView } from "@/lib/wp-curve";

// Every goal in order, grouped by period: time, team, scorer, assists,
// PP/SH/EN where the era's records mark them, and the score after it.
// Shared by current game pages (2007-08 on, names linked to player pages)
// and history pages (before 2007-08, where most players have no page).

export function periodName(n: number, type: string, reg = 3) {
  if (type === "OT" || n > reg) return n - reg > 1 ? `${n - reg}OT` : "OT";
  return ["", "1st", "2nd", "3rd"][n] ?? `${n}th`;
}

const H2 = { fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.35rem", textTransform: "uppercase" as const, letterSpacing: ".02em", margin: "0 0 .8rem" };
const CARD = { background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, padding: "1rem 1.25rem" } as const;

// The goal list is complete only if it adds up to the final score (the
// shootout's winning "goal" counts in the score but isn't a goal event).
// A few 2009-10 games are missing goals in the NHL's own feed; for those
// the summary is left off rather than shown short.
export function scoringIsComplete(g: HistoryGame): boolean {
  return g.goals.length === g.home.score + g.away.score - (g.finalState === "SO" ? 1 : 0);
}

// wpa: each goal's win probability added (by event id), with the game's
// biggest goal marked; shown under the score after it.
// linkPlayers: every player has a page (modern games); otherwise names
// link only for the game's players who do (g.linkedPlayers).
export function ScoringSummary({ g, linkPlayers = false, wpa }: { g: HistoryGame; linkPlayers?: boolean; wpa?: Map<number, GoalWpaView> }) {
  const linked = new Set(g.linkedPlayers ?? []);
  const biggest = wpa && wpa.size ? [...wpa.entries()].reduce((b, e) => (e[1].wpa > b[1].wpa ? e : b))[0] : null;
  const byPeriod = [...new Set(g.goals.map((x) => `${x.period}|${x.periodType}`))];
  const name = (label: string, id: number | null | undefined, bold = false) =>
    id && (linkPlayers || linked.has(id)) ? (
      <Link href={`/players/${id}`} style={{ color: "inherit", textDecoration: "none", fontWeight: bold ? 600 : undefined }}>
        {label}
      </Link>
    ) : (
      <span style={{ fontWeight: bold ? 600 : undefined }}>{label}</span>
    );
  return (
    <section style={{ marginBottom: "2.25rem" }}>
      <h2 style={H2}>Scoring</h2>
      <div style={CARD}>
        {g.goals.length === 0 && <p style={{ margin: 0, color: "var(--text-secondary)" }}>No goals.</p>}
        {byPeriod.map((key) => {
          const [n, type] = key.split("|");
          const goals = g.goals.filter((x) => `${x.period}|${x.periodType}` === key);
          return (
            <div key={key} style={{ marginBottom: ".8rem" }}>
              <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".05em", margin: ".3rem 0" }}>{periodName(Number(n), type)}</div>
              {goals.map((x, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "3.4rem 1fr auto", gap: 10, padding: "6px 0", borderTop: "1px solid var(--border)", fontSize: ".88rem" }}>
                  <span style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{x.time}</span>
                  <span>
                    <TeamLink abbrev={x.team} style={{ fontWeight: 700, color: "var(--gold)", marginRight: 6, whiteSpace: "nowrap" }}>
                      <TeamLogo abbrev={x.team} size={18} gap={3} />
                      {x.team}
                    </TeamLink>
                    {name(x.scorer ?? "Unknown scorer", x.scorerId, true)}
                    {(x.strength === "PP" || x.strength === "SH" || x.strength === "PS" || x.emptyNet) && g.hasStrength && (
                      <span style={{ fontSize: ".7rem", fontWeight: 700, color: "var(--text-secondary)", border: "1px solid var(--border)", borderRadius: 4, padding: "0 5px", marginLeft: 6 }}>
                        {[x.strength === "EV" ? null : x.strength, x.emptyNet ? "EN" : null].filter(Boolean).join(" · ")}
                      </span>
                    )}
                    <span style={{ display: "block", color: "var(--text-secondary)", fontSize: ".78rem" }}>
                      {x.assists.length === 0
                        ? g.assistsUncertain
                          ? "assist not recorded"
                          : "unassisted"
                        : x.assists.map((a, k) => (
                            <span key={k}>
                              {k === 0 ? "from " : ", "}
                              {name(a, x.assistIds?.[k])}
                            </span>
                          ))}
                    </span>
                  </span>
                  <span style={{ color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums", fontSize: ".82rem", whiteSpace: "nowrap", textAlign: "right" }}>
                    {g.away.code} {x.awayAfter}, {g.home.code} {x.homeAfter}
                    {wpa?.has(x.eventId) && (
                      <span
                        className={x.eventId === biggest ? "wpa-badge wpa-badge-top" : "wpa-badge"}
                        title={`Win chance for ${x.team}: ${Math.round(100 * wpa.get(x.eventId)!.before)}% before this goal, ${Math.round(100 * wpa.get(x.eventId)!.after)}% after`}
                      >
                        {x.eventId === biggest && <span className="wpa-badge-label">Biggest goal · </span>}
                        {formatWpa(wpa.get(x.eventId)!.wpa)} win chance
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
        {g.finalState === "SO" && <p style={{ margin: ".2rem 0 0", fontSize: ".8rem", color: "var(--text-secondary)" }}>Decided in a shootout.</p>}
      </div>
    </section>
  );
}
