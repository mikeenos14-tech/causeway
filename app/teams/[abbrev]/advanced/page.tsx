import { notFound } from "next/navigation";
import { getTeam } from "@/lib/homepage-data";
import { getRosterSeasonId, getAdvancedRosterStats } from "@/lib/roster-data";
import { formatSeasonLabel } from "@/lib/format-date";
import { Masthead, Footer } from "@/components/Masthead";
import { TeamSubNav } from "@/components/TeamSubNav";
import { StatsKey } from "@/components/StatsKey";
import { AdvancedTable } from "./AdvancedTable";

export const revalidate = 300;

const STAT_DEFINITIONS = [
  { term: "ixG (Individual Expected Goals)", definition: "The expected-goal value of this player's own shots — what an average shooter would score from the same attempts." },
  { term: "G vs xG", definition: "Actual goals minus ixG. Positive means he's finishing above what his shot quality alone suggests; negative means below." },
  { term: "iCorsi (Individual Corsi)", definition: "This player's own total shot attempts — shots on goal, missed shots, and blocked shots combined." },
  { term: "On-Ice xG%", definition: "His team's share of total expected goals (for vs. against) while he's on the ice, regardless of who's shooting." },
  { term: "On-Ice Corsi%", definition: "His team's share of total shot attempts (for vs. against) while he's on the ice — the classic “possession” read." },
];

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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.2rem,4.5vw,3rem)", textTransform: "uppercase", letterSpacing: ".01em", margin: "0 0 .4rem" }}>
            Advanced Stats
          </h1>
          <div style={{ marginTop: 6 }}>
            <StatsKey items={STAT_DEFINITIONS} />
          </div>
        </div>
        <p style={{ color: "var(--text-secondary)", fontSize: ".9rem", marginBottom: "2rem" }}>
          {seasonId ? `${formatSeasonLabel(seasonId)} regular season · individual expected goals & on-ice possession` : "No season loaded yet"}
        </p>

        {rows.length > 0 ? (
          <>
            <AdvancedTable rows={rows} />
            <p style={{ fontSize: ".72rem", color: "var(--text-secondary)", marginTop: 14 }}>Data via MoneyPuck.com.</p>
          </>
        ) : (
          <p style={{ color: "var(--text-secondary)", fontSize: ".9rem" }}>No advanced stats on file yet for this team&apos;s most recent loaded season.</p>
        )}
      </main>
      <Footer />
    </>
  );
}
