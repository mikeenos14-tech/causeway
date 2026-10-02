import { notFound } from "next/navigation";
import { getTeam } from "@/lib/homepage-data";
import { getCurrentRoster } from "@/lib/current-roster";
import { formatSeasonLabel } from "@/lib/format-date";
import { SkaterRosterTable, GoalieRosterTable } from "@/components/RosterTable";
import { Masthead, Footer } from "@/components/Masthead";
import { RosterMovesCard } from "@/components/RosterMovesCard";
import { getRosterMoves } from "@/lib/roster-moves";
import { getClubSeason } from "@/lib/nhl-schedule";
import { getCurrentCaptainName, leadershipBadge } from "@/lib/leadership";
import { TeamSubNav } from "@/components/TeamSubNav";
import { getHeadshots } from "@/lib/headshots";
import { RosterViewToggle } from "@/components/RosterViewToggle";

export const revalidate = 300;

export default async function TeamRoster({ params }: { params: Promise<{ abbrev: string }> }) {
  const { abbrev: rawAbbrev } = await params;
  const abbrev = rawAbbrev.toUpperCase();

  const team = await getTeam(abbrev);
  if (!team) notFound();

  // The NHL's current roster with this season's stats (lib/current-roster.ts).
  const [roster, club] = await Promise.all([getCurrentRoster(abbrev), getClubSeason(abbrev)]);
  const { seasonId, skaters, goalies } = roster;
  const lastSeason = club?.previousSeason ?? seasonId;
  const [moves, captainName] = await Promise.all([
    lastSeason ? getRosterMoves(abbrev, lastSeason) : Promise.resolve(null),
    getCurrentCaptainName(abbrev, club?.currentSeason ?? null),
  ]);
  const headshots = await getHeadshots([...skaters, ...goalies].map((r) => r.id));
  // "C"/"A" only on the season the designation applies to.
  const badges = Object.fromEntries(
    seasonId ? [...skaters, ...goalies].map((r) => [r.id, leadershipBadge(abbrev, seasonId, r.id)]).filter(([, b]) => b) : [],
  ) as Record<number, "C" | "A">;

  return (
    <>
      <Masthead />
      <main style={{ maxWidth: 1160, margin: "0 auto", padding: "1.5rem 24px 3.5rem" }}>
        <TeamSubNav abbrev={abbrev} />
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.2rem,4.5vw,3rem)", textTransform: "uppercase", letterSpacing: ".01em", margin: "0 0 .4rem" }}>
          Roster &amp; Stats
        </h1>
        <RosterViewToggle abbrev={abbrev} view="standard" />
        <p style={{ color: "var(--text-secondary)", fontSize: ".9rem", marginBottom: "2rem" }}>
          {formatSeasonLabel(seasonId)} regular season ·{" "}
          {roster.teamGamesPlayed === 0 ? "the current roster; stats start with the first game" : "tap or click a column to sort"}
        </p>
        {!roster.rosterAvailable && (
          <p style={{ color: "var(--text-secondary)", fontSize: ".85rem", margin: "-1.25rem 0 2rem" }}>
            The NHL&apos;s roster couldn&apos;t be reached just now, so this lists players who&apos;ve played this season.
          </p>
        )}

        {moves && <RosterMovesCard teamAbbrev={abbrev} moves={moves} captainName={captainName} />}

        <section style={{ marginBottom: "2.5rem" }}>
          <h2 style={{ margin: "0 0 1rem", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.4rem", textTransform: "uppercase", letterSpacing: ".02em" }}>Skaters</h2>
          {skaters.length > 0 ? (
            <SkaterRosterTable rows={skaters} badges={badges} headshots={headshots} />
          ) : (
            <p style={{ color: "var(--text-secondary)", fontSize: ".9rem" }}>No skaters on the roster.</p>
          )}
        </section>

        <section>
          <h2 style={{ margin: "0 0 1rem", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.4rem", textTransform: "uppercase", letterSpacing: ".02em" }}>Goalies</h2>
          {goalies.length > 0 ? (
            <GoalieRosterTable rows={goalies} badges={badges} headshots={headshots} />
          ) : (
            <p style={{ color: "var(--text-secondary)", fontSize: ".9rem" }}>No goalies on the roster.</p>
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}
