import { notFound } from "next/navigation";
import { getTeam } from "@/lib/homepage-data";
import { getRosterSeasonId, getAdvancedRosterStats } from "@/lib/roster-data";
import { formatSeasonLabel } from "@/lib/format-date";
import { Masthead, Footer } from "@/components/Masthead";
import { TeamSubNav } from "@/components/TeamSubNav";
import { AdvancedTable } from "./AdvancedTable";

export const revalidate = 300;

export default async function TeamAdvancedStats({ params }: { params: Promise<{ abbrev: string }> }) {
  const { abbrev: rawAbbrev } = await params;
  const abbrev = rawAbbrev.toUpperCase();

  const team = await getTeam(abbrev);
  if (!team) notFound();

  const seasonId = await getRosterSeasonId(abbrev);
  const rows = seasonId ? await getAdvancedRosterStats(abbrev, seasonId) : [];

  return (
    <>
      <Masthead />
      <main style={{ maxWidth: 1160, margin: "0 auto", padding: "1.5rem 24px 3.5rem" }}>
        <TeamSubNav abbrev={abbrev} />
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.2rem,4.5vw,3rem)", textTransform: "uppercase", letterSpacing: ".01em", margin: "0 0 .4rem" }}>
          Advanced Stats
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: ".9rem", marginBottom: "2rem" }}>
          {seasonId ? `${formatSeasonLabel(seasonId)} regular season · individual expected goals & on-ice possession` : "No season loaded yet"}
        </p>

        {rows.length > 0 ? (
          <>
            <AdvancedTable rows={rows} />
            <p style={{ fontSize: ".78rem", color: "var(--text-secondary)", marginTop: 14 }}>
              <strong>ixG</strong> — this player&apos;s own expected goals from the shots he took. <strong>G vs xG</strong> — actual goals minus
              ixG; positive means finishing above what the shots themselves suggested. <strong>iCorsi</strong> — his own shot attempts (for, not
              against). <strong>On-Ice xG%/Corsi%</strong> — his team&apos;s share of expected goals/shot attempts while he&apos;s on the ice, a
              read on whether play moves the right direction when he&apos;s out there, independent of who&apos;s scoring. Data via MoneyPuck.com.
            </p>
          </>
        ) : (
          <p style={{ color: "var(--text-secondary)", fontSize: ".9rem" }}>No advanced stats on file yet for this team&apos;s most recent loaded season.</p>
        )}
      </main>
      <Footer />
    </>
  );
}
