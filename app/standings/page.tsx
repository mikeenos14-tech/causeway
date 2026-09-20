import Link from "next/link";
import { getLatestStandingsDate, getFullStandings, getConferencePictures, type WildCardTeam } from "@/lib/standings-data";
import { formatGameDate } from "@/lib/format-date";
import { Masthead, Footer } from "@/components/Masthead";

function PictureRow({ label, team, pointsBack }: { label: string; team: WildCardTeam; pointsBack?: number }) {
  const isBos = team.abbrev === "BOS";
  return (
    <Link
      href={`/teams/${team.abbrev}`}
      className="standings-row"
      style={{
        gridTemplateColumns: "34px 1fr 60px 60px",
        padding: "10px 18px",
        alignItems: "center",
        fontSize: ".85rem",
        borderTop: "1px solid var(--border)",
        textDecoration: "none",
        background: isBos ? "rgba(255,184,28,0.08)" : "transparent",
        borderLeft: isBos ? "3px solid var(--gold)" : "3px solid transparent",
        color: isBos ? "var(--text-primary)" : "var(--text-secondary)",
        fontWeight: isBos ? 700 : 400,
      }}
    >
      <span style={{ color: isBos ? "var(--gold)" : "var(--text-secondary)", fontSize: ".72rem", fontWeight: 700 }}>{label}</span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 8 }}>{team.name}</span>
      <span style={{ color: isBos ? "var(--gold)" : "inherit", fontWeight: 700 }}>{team.points}</span>
      <span style={{ fontSize: ".78rem" }}>{pointsBack != null ? (pointsBack === 0 ? "—" : `-${pointsBack}`) : ""}</span>
    </Link>
  );
}

export default async function Standings() {
  const date = await getLatestStandingsDate();
  const rows = date ? await getFullStandings(date) : [];
  const pictures = date ? await getConferencePictures(date) : [];

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

        {pictures.length > 0 && (
          <section style={{ marginBottom: "3rem" }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".02em", fontSize: "1.4rem", margin: "0 0 1rem" }}>
              Playoff Picture
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: "1.75rem" }}>
              {pictures.map((pic) => {
                const cutoff = pic.wildCard[1]?.points ?? 0;
                return (
                  <div key={pic.conference} style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                    <div style={{ padding: "10px 18px", fontSize: ".78rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", borderBottom: "1px solid var(--border)" }}>
                      {pic.conference}
                    </div>
                    {Object.entries(pic.divisionLeaders).map(([division, teams]) =>
                      teams.map((team, i) => <PictureRow key={team.abbrev} label={`${division.slice(0, 3).toUpperCase()} ${i + 1}`} team={team} />),
                    )}
                    {pic.wildCard.map((team, i) => (
                      <div key={team.abbrev}>
                        {i === 2 && (
                          <div style={{ borderTop: "1px dashed var(--border-strong)", padding: "2px 18px", fontSize: ".65rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>
                            Out of a playoff spot
                          </div>
                        )}
                        <PictureRow
                          label={i < 2 ? `WC${i + 1}` : ""}
                          team={team}
                          pointsBack={i < 2 ? undefined : cutoff - team.points}
                        />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".02em", fontSize: "1.4rem", margin: "0 0 1rem" }}>
          By Division
        </h2>
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
