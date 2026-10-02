import { notFound } from "next/navigation";
import { getTeam } from "@/lib/homepage-data";
import { getCurrentRoster } from "@/lib/current-roster";
import { formatSeasonLabel } from "@/lib/format-date";
import { SkaterRosterTable, GoalieRosterTable, type SkaterColumn } from "@/components/RosterTable";
import { Masthead, Footer } from "@/components/Masthead";
import { RosterMovesCard } from "@/components/RosterMovesCard";
import { getRosterMoves } from "@/lib/roster-moves";
import { getClubSeason } from "@/lib/nhl-schedule";
import { getCurrentCaptainName, leadershipBadge } from "@/lib/leadership";
import { TeamSubNav } from "@/components/TeamSubNav";
import { getHeadshots } from "@/lib/headshots";
import { RosterViewToggle } from "@/components/RosterViewToggle";
import { SeasonPicker } from "@/components/SeasonPicker";
import { getTeamRosterSeasons, getPastRoster, SITE_DATA_FROM } from "@/lib/roster-seasons";

export const revalidate = 300;

export default async function TeamRoster({ params, searchParams }: { params: Promise<{ abbrev: string }>; searchParams: Promise<{ season?: string }> }) {
  const { abbrev: rawAbbrev } = await params;
  const abbrev = rawAbbrev.toUpperCase();
  const { season: requested } = await searchParams;

  const team = await getTeam(abbrev);
  if (!team) notFound();

  // Season picker: the current season is the live roster below; a past
  // season (any the team played and has trustworthy stats for) shows every
  // player who played for it that season.
  const pastSeasons = await getTeamRosterSeasons(Number(team.id));

  // The NHL's current roster with this season's stats (lib/current-roster.ts).
  const [roster, club] = await Promise.all([getCurrentRoster(abbrev), getClubSeason(abbrev)]);
  const { seasonId, skaters, goalies } = roster;
  const seasons = [...new Set([seasonId, ...pastSeasons])].sort().reverse();
  const pastSeason = requested && requested !== seasonId && pastSeasons.includes(requested) ? requested : null;
  if (pastSeason) return <PastRoster abbrev={abbrev} teamId={Number(team.id)} teamName={team.name} seasonId={pastSeason} seasons={seasons} />;
  const picker = seasons.length > 1 ? <SeasonPicker seasons={seasons} current={seasonId} basePath={`/teams/${abbrev}/roster`} /> : null;
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
        {picker && <div style={{ marginBottom: "1rem" }}>{picker}</div>}
        <p style={{ color: "var(--text-secondary)", fontSize: ".9rem", marginBottom: "2rem" }}>
          {formatSeasonLabel(seasonId)} regular season ·{" "}
          {roster.teamGamesPlayed === 0 ? "the current roster; stats start with the first game" : "tap or click a column to sort"}
        </p>
        {!roster.rosterAvailable && (
          <p style={{ color: "var(--text-secondary)", fontSize: ".85rem", margin: "-1.25rem 0 2rem" }}>
            The NHL&apos;s roster couldn&apos;t be loaded just now, so this lists players who&apos;ve played this season.
          </p>
        )}
        {roster.syncedAt && (
          <p style={{ color: "var(--text-muted)", fontSize: ".78rem", margin: "-1.5rem 0 2rem" }}>
            Roster from the NHL, updated hourly · last updated{" "}
            {new Date(roster.syncedAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET
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

async function PastRoster({ abbrev, teamId, teamName, seasonId, seasons }: { abbrev: string; teamId: number; teamName: string; seasonId: string; seasons: string[] }) {
  const r = await getPastRoster(abbrev, teamId, seasonId);
  const omit: SkaterColumn[] = [...(r.tracked.detail ? [] : (["toi", "hits", "blocks", "pp_goals"] as SkaterColumn[])), ...(r.tracked.shots ? [] : (["shots"] as SkaterColumn[])), ...(r.tracked.plusMinus ? [] : (["plus_minus"] as SkaterColumn[]))];
  const headshots = await getHeadshots([...r.skaters, ...r.goalies].map((x) => x.id));
  const H2 = { margin: "0 0 1rem", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.4rem", textTransform: "uppercase" as const, letterSpacing: ".02em" };
  return (
    <>
      <Masthead />
      <main style={{ maxWidth: 1160, margin: "0 auto", padding: "1.5rem 24px 3.5rem" }}>
        <TeamSubNav abbrev={abbrev} />
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.2rem,4.5vw,3rem)", textTransform: "uppercase", letterSpacing: ".01em", margin: "0 0 .4rem" }}>
          Roster &amp; Stats
        </h1>
        <div style={{ marginBottom: "1rem" }}>
          <SeasonPicker seasons={seasons} current={seasonId} basePath={`/teams/${abbrev}/roster`} />
        </div>
        <p style={{ color: "var(--text-secondary)", fontSize: ".9rem", marginBottom: "2rem" }}>
          {formatSeasonLabel(seasonId)} regular season · everyone who played for the {teamName} · tap or click a column to sort
          {seasonId < SITE_DATA_FROM && (
            <span style={{ display: "block", color: "var(--text-muted)", fontSize: ".8rem", marginTop: 4 }}>
              From the NHL&apos;s game records.{!r.tracked.plusMinus ? " Plus-minus and shots weren't kept by player until 1959-60." : ""} Ice time, hits and blocks start in 2007-08 here.
            </span>
          )}
        </p>
        <section style={{ marginBottom: "2.5rem" }}>
          <h2 style={H2}>Skaters</h2>
          {r.skaters.length > 0 ? <SkaterRosterTable rows={r.skaters} headshots={headshots} omit={omit} /> : <p style={{ color: "var(--text-secondary)", fontSize: ".9rem" }}>No skater stats for this season.</p>}
        </section>
        <section>
          <h2 style={H2}>Goalies</h2>
          {r.goalies.length > 0 ? (
            <GoalieRosterTable rows={r.goalies} headshots={headshots} ties={seasonId < "20052006"} otl={seasonId >= "19992000"} />
          ) : (
            <p style={{ color: "var(--text-secondary)", fontSize: ".9rem" }}>The NHL&apos;s game records for this season don&apos;t include goalie stats.</p>
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}

