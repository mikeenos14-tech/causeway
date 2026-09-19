import Link from "next/link";
import { getLatestStandingsDate, getFullStandings } from "@/lib/standings-data";
import { formatGameDate } from "@/lib/format-date";
import { Masthead, Footer } from "@/components/Masthead";

export default async function Standings() {
  const date = await getLatestStandingsDate();
  const rows = date ? await getFullStandings(date) : [];

  const byDivision = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byDivision.has(r.division)) byDivision.set(r.division, []);
    byDivision.get(r.division)!.push(r);
  }

  return (
    <>
      <Masthead />
      <main style={{ maxWidth: 1160, margin: "0 auto", padding: "3rem 24px 3.5rem" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.2rem,4.5vw,3rem)", textTransform: "uppercase", letterSpacing: ".01em", margin: "0 0 .4rem" }}>
          Standings
        </h1>
        {date && (
          <p style={{ color: "var(--text-secondary)", fontSize: ".9rem", marginBottom: "2.5rem" }}>
            As of {formatGameDate(date, true)}
          </p>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: "1.75rem" }}>
          {[...byDivision.entries()].map(([division, teams]) => (
            <section key={division}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: ".9rem" }}>
                <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".02em", fontSize: "1.4rem", margin: 0 }}>
                  {division}
                </h2>
                <span style={{ fontSize: ".78rem", color: "var(--text-secondary)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>
                  {teams[0].conference}
                </span>
              </div>
              <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                <div className="standings-row" style={{ padding: "10px 18px", fontSize: ".68rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", borderBottom: "1px solid var(--border)" }}>
                  <span>#</span><span>Team</span><span className="standings-col-gp">GP</span><span>W</span><span>L</span><span className="standings-col-otl">OTL</span><span>PTS</span>
                </div>
                {teams.map((t) => (
                  <Link
                    key={t.abbrev}
                    href={`/teams/${t.abbrev}`}
                    className="standings-row"
                    style={{
                      padding: "12px 18px",
                      alignItems: "center",
                      fontSize: ".88rem",
                      borderTop: "1px solid var(--border)",
                      textDecoration: "none",
                      background: t.abbrev === "BOS" ? "rgba(255,184,28,0.08)" : "transparent",
                      borderLeft: t.abbrev === "BOS" ? "3px solid var(--gold)" : "3px solid transparent",
                      color: t.abbrev === "BOS" ? "var(--text-primary)" : "var(--text-secondary)",
                      fontWeight: t.abbrev === "BOS" ? 700 : 400,
                    }}
                  >
                    <span style={{ color: t.abbrev === "BOS" ? "var(--gold)" : "inherit" }}>{t.division_rank}</span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 8 }}>{t.name}</span>
                    <span className="standings-col-gp">{t.games_played}</span>
                    <span>{t.wins}</span>
                    <span>{t.losses}</span>
                    <span className="standings-col-otl">{t.ot_losses}</span>
                    <span style={{ color: t.abbrev === "BOS" ? "var(--gold)" : "inherit", fontWeight: 700 }}>{t.points}</span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
      <Footer />
    </>
  );
}
