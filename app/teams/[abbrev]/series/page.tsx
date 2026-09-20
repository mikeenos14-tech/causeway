import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeam } from "@/lib/homepage-data";
import { getLatestSeasonId } from "@/lib/schedule-data";
import { getAllSeasonSeriesForTeam } from "@/lib/season-series-data";
import { formatGameDate, formatSeasonLabel } from "@/lib/format-date";
import { Masthead, Footer } from "@/components/Masthead";

export const revalidate = 300;

export default async function TeamSeasonSeries({ params }: { params: Promise<{ abbrev: string }> }) {
  const { abbrev: rawAbbrev } = await params;
  const abbrev = rawAbbrev.toUpperCase();

  const team = await getTeam(abbrev);
  if (!team) notFound();

  const seasonId = await getLatestSeasonId(abbrev);
  const series = seasonId ? await getAllSeasonSeriesForTeam(abbrev, seasonId) : [];

  return (
    <>
      <Masthead />
      <main style={{ maxWidth: 1160, margin: "0 auto", padding: "3rem 24px 3.5rem" }}>
        <Link href={`/teams/${abbrev}`} style={{ fontSize: ".82rem", fontWeight: 600, color: "var(--gold)", textDecoration: "none" }}>
          ← {team.name}
        </Link>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.2rem,4.5vw,3rem)", textTransform: "uppercase", letterSpacing: ".01em", margin: ".4rem 0 .4rem" }}>
          Season Series
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: ".9rem", marginBottom: "2rem" }}>
          {seasonId ? `${formatSeasonLabel(seasonId)} regular season · head-to-head record vs. every opponent played` : "No season loaded yet"}
        </p>

        {series.length > 0 ? (
          <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            <div className="schedule-row" style={{ gridTemplateColumns: "1fr 90px 90px 140px", padding: "10px 18px", fontSize: ".68rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", borderBottom: "1px solid var(--border)" }}>
              <span>Opponent</span>
              <span>GP</span>
              <span>Record</span>
              <span>Last Meeting</span>
            </div>
            {series.map((s) => {
              const leading = s.wins > s.losses + s.otl;
              const trailing = s.wins < s.losses + s.otl;
              return (
                <div
                  key={s.opp_abbrev}
                  className="schedule-row"
                  style={{
                    gridTemplateColumns: "1fr 90px 90px 140px",
                    padding: "12px 18px",
                    alignItems: "center",
                    fontSize: ".88rem",
                    borderTop: "1px solid var(--border)",
                  }}
                >
                  <Link href={`/teams/${s.opp_abbrev}`} style={{ color: "var(--text-primary)", textDecoration: "none", fontWeight: 600 }}>
                    {s.opp_name}
                  </Link>
                  <span style={{ color: "var(--text-secondary)" }}>{s.games}</span>
                  <span style={{ fontWeight: 700, color: leading ? "var(--win)" : trailing ? "var(--loss)" : "var(--text-secondary)" }}>
                    {s.wins}-{s.losses}-{s.otl}
                  </span>
                  <span style={{ color: "var(--text-secondary)" }}>{formatGameDate(s.last_meeting)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p style={{ color: "var(--text-secondary)", fontSize: ".9rem" }}>No regular-season games on file yet for this season.</p>
        )}
      </main>
      <Footer />
    </>
  );
}
