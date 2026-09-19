import Link from "next/link";
import { getLatestSeasonId, getSeasonSchedule } from "@/lib/schedule-data";
import { formatGameDate, formatSeasonLabel } from "@/lib/format-date";
import { Masthead, Footer } from "@/components/Masthead";

export default async function Schedule() {
  const seasonId = await getLatestSeasonId("BOS");
  const games = seasonId ? await getSeasonSchedule("BOS", seasonId) : [];

  return (
    <>
      <Masthead />
      <main style={{ maxWidth: 1160, margin: "0 auto", padding: "3rem 24px 3.5rem" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.2rem,4.5vw,3rem)", textTransform: "uppercase", letterSpacing: ".01em", margin: "0 0 .4rem" }}>
          {seasonId ? `${formatSeasonLabel(seasonId)} Schedule` : "Schedule"}
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: ".9rem", marginBottom: "2rem" }}>
          {games.length} games · Boston Bruins
        </p>

        <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          <div className="schedule-row" style={{ padding: "10px 18px", fontSize: ".68rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", borderBottom: "1px solid var(--border)" }}>
            <span>Date</span><span className="schedule-col-type">Type</span><span>Matchup</span><span>Result</span>
          </div>
          {games.map((g) => {
            const played = g.team_score != null;
            const won = played && g.team_score > g.opp_score;
            const row = (
              <div
                className="schedule-row"
                style={{
                  padding: "12px 18px",
                  alignItems: "center",
                  fontSize: ".88rem",
                  borderTop: "1px solid var(--border)",
                  color: "var(--text-secondary)",
                }}
              >
                <span style={{ color: "var(--text-primary)" }}>{formatGameDate(g.game_date)}</span>
                <span className="schedule-col-type" style={{ fontSize: ".78rem" }}>{g.game_type === "playoff" ? "Playoff" : g.game_type === "preseason" ? "Preseason" : ""}</span>
                <span style={{ color: "var(--text-primary)" }}>
                  {g.is_home ? "vs" : "@"} {g.opponent}
                  {(g.has_highlight || g.has_recap) && (
                    <span style={{ color: "var(--gold)", marginLeft: 8, fontSize: ".75rem" }} title={g.has_highlight ? "Highlight available" : "Recap available"}>
                      {g.has_highlight ? "★" : "●"}
                    </span>
                  )}
                </span>
                <span>
                  {played ? (
                    <span style={{ color: won ? "var(--win)" : "var(--loss)", fontWeight: 700 }}>
                      {won ? "W" : "L"} {g.team_score}-{g.opp_score}
                      {g.game_end_type === "overtime" ? " OT" : g.game_end_type === "shootout" ? " SO" : ""}
                    </span>
                  ) : (
                    <span style={{ color: "var(--text-secondary)" }}>—</span>
                  )}
                </span>
              </div>
            );
            return played ? (
              <Link key={g.id} href={`/games/${g.id}`} style={{ display: "block", textDecoration: "none" }}>
                {row}
              </Link>
            ) : (
              <div key={g.id}>{row}</div>
            );
          })}
        </div>
      </main>
      <Footer />
    </>
  );
}
