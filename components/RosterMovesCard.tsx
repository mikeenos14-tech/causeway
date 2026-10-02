import Link from "next/link";
import type { RosterMoves } from "@/lib/roster-moves";
import { LEADERSHIP } from "@/lib/leadership";
import { formatGameDate, formatSeasonLabel } from "@/lib/format-date";

const ROW = { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "9px 0", borderTop: "1px solid var(--border)", fontSize: ".9rem" } as const;
const SUB = { fontSize: ".8rem", color: "var(--text-secondary)", textAlign: "right" as const };

// Who's new, who's gone, and who wears the C — the team's current NHL
// roster against last season's. Rendered on the Roster tab always, and on
// the team dashboard around the start of a season.
export function RosterMovesCard({ teamAbbrev, moves, captainName }: { teamAbbrev: string; moves: RosterMoves; captainName: string | null }) {
  const leadership = LEADERSHIP[teamAbbrev];
  const last = formatSeasonLabel(moves.lastSeason);
  if (moves.arrivals.length === 0 && moves.departures.length === 0 && !captainName) return null;

  return (
    <section style={{ marginBottom: "2.5rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.5rem", textTransform: "uppercase", letterSpacing: ".02em" }}>Roster Changes</h2>
        <span style={{ fontSize: ".78rem", color: "var(--text-secondary)" }}>Current NHL roster vs. {last}</span>
      </div>

      {captainName && leadership && (
        <p style={{ fontSize: ".9rem", margin: "0 0 1rem", color: "var(--text-secondary)" }}>
          <span style={{ display: "inline-block", fontWeight: 700, color: "var(--ink)", background: "var(--gold)", borderRadius: 4, padding: "0 6px", marginRight: 8, fontSize: ".78rem" }}>C</span>
          <Link href={`/players/${leadership.captainId}`} style={{ color: "var(--text-primary)", fontWeight: 600, textDecoration: "none" }}>
            {captainName}
          </Link>{" "}
          named captain {formatGameDate(leadership.asOf, true)}
          {leadership.alternateIds.length === 0 ? " · alternates not yet announced" : ""} ·{" "}
          <a href={leadership.source} style={{ color: "var(--gold)", textDecoration: "none" }}>
            source ↗
          </a>
        </p>
      )}

      <div className="card-row" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", alignItems: "start" }}>
        <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 10, padding: "1rem 1.2rem" }}>
          <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--win)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>
            In · {moves.arrivals.length}
          </div>
          {moves.arrivals.map((a) => (
            <div key={a.id} className="move-row" style={ROW}>
              <span>
                {a.number != null && <span style={{ color: "var(--text-secondary)", marginRight: 6 }}>#{a.number}</span>}
                {a.previous ? (
                  <Link href={`/players/${a.id}`} style={{ color: "var(--text-primary)", fontWeight: 600, textDecoration: "none" }}>
                    {a.name}
                  </Link>
                ) : (
                  <span style={{ fontWeight: 600 }}>{a.name}</span>
                )}{" "}
                <span style={{ color: "var(--text-secondary)", fontSize: ".8rem" }}>{a.position}</span>
              </span>
              <span className="move-detail" style={SUB}>
                {!a.previous
                  ? "no NHL games yet"
                  : a.previous.abbrev === teamAbbrev
                    ? `back with ${teamAbbrev} · ${a.previous.games} GP in ${formatSeasonLabel(a.previous.season)}`
                    : `from ${a.previous.abbrev} · ${a.previous.games} GP in ${formatSeasonLabel(a.previous.season)}`}
              </span>
            </div>
          ))}
          {moves.arrivals.length === 0 && <p style={{ ...SUB, textAlign: "left", margin: "6px 0 0" }}>No new faces.</p>}
        </div>

        <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 10, padding: "1rem 1.2rem" }}>
          <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--loss)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>
            Out · {moves.departures.length}
          </div>
          {moves.departures.map((d) => (
            <div key={d.id} className="move-row" style={ROW}>
              <span>
                <Link href={`/players/${d.id}`} style={{ color: "var(--text-primary)", fontWeight: 600, textDecoration: "none" }}>
                  {d.name}
                </Link>{" "}
                <span style={{ color: "var(--text-secondary)", fontSize: ".8rem" }}>{d.position}</span>
              </span>
              <span className="move-detail" style={SUB}>
                {/* "system" = still this team's player per the NHL, but not on the
                    current roster list — injured, in the minors, or waived; the
                    API doesn't say which, so neither do we. */}
                {d.now.kind === "team" ? `now with ${d.now.abbrev}` : d.now.kind === "system" ? `still with ${teamAbbrev}, off the current roster` : d.now.kind === "none" ? "not on an NHL roster" : "current status unavailable"} ·{" "}
                {d.games} GP here in {last}
              </span>
            </div>
          ))}
          {moves.departures.length === 0 && <p style={{ ...SUB, textAlign: "left", margin: "6px 0 0" }}>Nobody who played 10+ games left.</p>}
        </div>
      </div>
      <p style={{ fontSize: ".72rem", color: "var(--text-muted)", marginTop: 8 }}>
        Departures list players with 10+ games here last season. Rosters change often in the first weeks; this reflects the NHL&apos;s current roster.
      </p>
    </section>
  );
}
