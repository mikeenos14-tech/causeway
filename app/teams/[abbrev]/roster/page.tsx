import { notFound } from "next/navigation";
import { getTeam } from "@/lib/homepage-data";
import { getRosterSeasonId, getSkaterRosterStats, getGoalieRosterStats } from "@/lib/roster-data";
import { formatSeasonLabel } from "@/lib/format-date";
import { SkaterRosterTable, GoalieRosterTable } from "@/components/RosterTable";
import { Masthead, Footer } from "@/components/Masthead";
import { TeamSubNav } from "@/components/TeamSubNav";

export const revalidate = 300;

export default async function TeamRoster({ params }: { params: Promise<{ abbrev: string }> }) {
  const { abbrev: rawAbbrev } = await params;
  const abbrev = rawAbbrev.toUpperCase();

  const team = await getTeam(abbrev);
  if (!team) notFound();

  const seasonId = await getRosterSeasonId(abbrev);
  const [skaters, goalies] = seasonId
    ? await Promise.all([getSkaterRosterStats(abbrev, seasonId), getGoalieRosterStats(abbrev, seasonId)])
    : [[], []];

  return (
    <>
      <Masthead />
      <main style={{ maxWidth: 1160, margin: "0 auto", padding: "1.5rem 24px 3.5rem" }}>
        <TeamSubNav abbrev={abbrev} />
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.2rem,4.5vw,3rem)", textTransform: "uppercase", letterSpacing: ".01em", margin: "0 0 .4rem" }}>
          Roster &amp; Stats
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: ".9rem", marginBottom: "2rem" }}>
          {seasonId ? `${formatSeasonLabel(seasonId)} regular season · click any column to sort` : "No season loaded yet"}
        </p>

        <section style={{ marginBottom: "2.5rem" }}>
          <h2 style={{ margin: "0 0 1rem", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.4rem", textTransform: "uppercase", letterSpacing: ".02em" }}>Skaters</h2>
          {skaters.length > 0 ? (
            <SkaterRosterTable rows={skaters} />
          ) : (
            <p style={{ color: "var(--text-secondary)", fontSize: ".9rem" }}>No skater stats on file yet for this season.</p>
          )}
        </section>

        <section>
          <h2 style={{ margin: "0 0 1rem", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.4rem", textTransform: "uppercase", letterSpacing: ".02em" }}>Goalies</h2>
          {goalies.length > 0 ? (
            <GoalieRosterTable rows={goalies} />
          ) : (
            <p style={{ color: "var(--text-secondary)", fontSize: ".9rem" }}>No goalie stats on file yet for this season.</p>
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}
