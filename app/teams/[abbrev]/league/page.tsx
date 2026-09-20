import { notFound } from "next/navigation";
import { getTeam } from "@/lib/homepage-data";
import { getCurrentLeagueSeasonId, getLeagueTeamStats, rankTeam, type LeagueTeamStats } from "@/lib/league-data";
import { formatSeasonLabel } from "@/lib/format-date";
import { Masthead, Footer } from "@/components/Masthead";
import { TeamSubNav } from "@/components/TeamSubNav";

export const revalidate = 300;

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function RankCard({
  label,
  teams,
  abbrev,
  metric,
  higherIsBetter,
  format,
}: {
  label: string;
  teams: LeagueTeamStats[];
  abbrev: string;
  metric: (t: LeagueTeamStats) => number | null;
  higherIsBetter: boolean;
  format: (v: number) => string;
}) {
  const rank = rankTeam(teams, abbrev, metric, higherIsBetter);
  if (!rank) return null;

  const range = rank.max - rank.min || 1;
  // The track always reads min (left) to max (right), regardless of which
  // direction is "good" — the fill always runs from the left edge to the
  // team's actual position, so it's a plain "where do we sit on the
  // range" bar. Whether that position is good or bad is what the rank
  // number ("4th of 32") next to it says; the bar itself is just literal.
  const teamPct = ((rank.value - rank.min) / range) * 100;
  const avgPct = ((rank.leagueAvg - rank.min) / range) * 100;

  return (
    <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.25rem 1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <span style={{ fontSize: ".78rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: "1.3rem" }}>
          {format(rank.value)} <span style={{ fontSize: ".95rem", color: "var(--gold)" }}>{ordinal(rank.rank)} of {rank.outOf}</span>
        </span>
      </div>
      <div style={{ position: "relative", height: 8, borderRadius: 4, background: "var(--border)" }}>
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: `${teamPct}%`,
            borderRadius: 4,
            background: "linear-gradient(90deg, rgba(255,184,28,0.35), var(--gold))",
          }}
        />
        <div
          aria-hidden
          title="League average"
          style={{
            position: "absolute",
            top: -3,
            left: `calc(${avgPct}% - 1px)`,
            width: 2,
            height: 14,
            background: "var(--text-secondary)",
            opacity: 0.6,
          }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: ".7rem", color: "var(--text-secondary)" }}>
        <span>{format(rank.min)}</span>
        <span>league avg {format(rank.leagueAvg)}</span>
        <span>{format(rank.max)}</span>
      </div>
    </div>
  );
}

export default async function TeamLeagueComparison({ params }: { params: Promise<{ abbrev: string }> }) {
  const { abbrev: rawAbbrev } = await params;
  const abbrev = rawAbbrev.toUpperCase();

  const team = await getTeam(abbrev);
  if (!team) notFound();

  const seasonId = await getCurrentLeagueSeasonId();
  const teams = seasonId ? await getLeagueTeamStats(seasonId) : [];
  const own = teams.find((t) => t.abbrev === abbrev);

  // Only show a special-teams card once THIS team's own season is fully
  // covered — a partial average (e.g. 8 of 40 games) would be a real
  // number that's still a misleading stand-in for the season, the same
  // trap the site avoided earlier with synthetic season-blending. It
  // simply appears on its own once the backfill catches up to it, no
  // code change needed.
  const specialTeamsReady = (own?.specialTeamsCoverage ?? 0) >= 0.99;
  // MoneyPuck's own game-by-game coverage genuinely starts at the 2008-09
  // season league-wide (confirmed against their real file) — irrelevant
  // here in practice since this page always shows the current season, but
  // the same >=0.99 bar as special teams is still the right one to use.
  const xgReady = (own?.xgCoverage ?? 0) >= 0.99;

  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const perGame = (v: number) => v.toFixed(2);

  return (
    <>
      <Masthead />
      <main style={{ maxWidth: 1160, margin: "0 auto", padding: "1.5rem 24px 3.5rem" }}>
        <TeamSubNav abbrev={abbrev} />
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.2rem,4.5vw,3rem)", textTransform: "uppercase", letterSpacing: ".01em", margin: "0 0 .4rem" }}>
          League Comparison
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: ".9rem", marginBottom: "2rem" }}>
          {seasonId ? `${formatSeasonLabel(seasonId)} regular season · vs. all ${teams.length} NHL teams` : "No season loaded yet"}
        </p>

        {own ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginBottom: specialTeamsReady ? 14 : 0 }}>
              <RankCard label="Points %" teams={teams} abbrev={abbrev} metric={(t) => t.pointsPct} higherIsBetter format={pct} />
              <RankCard label="Goals For / Game" teams={teams} abbrev={abbrev} metric={(t) => t.goalsForPerGame} higherIsBetter format={perGame} />
              <RankCard label="Goals Against / Game" teams={teams} abbrev={abbrev} metric={(t) => t.goalsAgainstPerGame} higherIsBetter={false} format={perGame} />
            </div>

            {specialTeamsReady ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginBottom: xgReady ? 14 : 0 }}>
                <RankCard label="Power Play %" teams={teams} abbrev={abbrev} metric={(t) => t.ppPct} higherIsBetter format={pct} />
                <RankCard label="Penalty Kill %" teams={teams} abbrev={abbrev} metric={(t) => t.pkPct} higherIsBetter format={pct} />
                <RankCard label="Faceoff Win %" teams={teams} abbrev={abbrev} metric={(t) => t.faceoffWinPct} higherIsBetter format={pct} />
              </div>
            ) : (
              <p style={{ fontSize: ".82rem", color: "var(--text-secondary)", marginTop: 14 }}>
                Power play, penalty kill, and faceoff comparisons appear once this season&apos;s special-teams data finishes loading
                {own.specialTeamsCoverage > 0 ? ` (${Math.round(own.specialTeamsCoverage * 100)}% loaded)` : ""}.
              </p>
            )}

            {xgReady ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
                  <RankCard label="Expected Goals For / Game" teams={teams} abbrev={abbrev} metric={(t) => t.xgForPerGame} higherIsBetter format={perGame} />
                  <RankCard label="Expected Goals Against / Game" teams={teams} abbrev={abbrev} metric={(t) => t.xgAgainstPerGame} higherIsBetter={false} format={perGame} />
                </div>
                <p style={{ fontSize: ".72rem", color: "var(--text-secondary)", marginTop: 10 }}>Expected goals (xG) data via MoneyPuck.com.</p>
              </>
            ) : (
              <p style={{ fontSize: ".82rem", color: "var(--text-secondary)", marginTop: 14 }}>
                Expected goals (xG) comparisons appear once this season&apos;s data finishes loading from MoneyPuck.com
                {own.xgCoverage > 0 ? ` (${Math.round(own.xgCoverage * 100)}% loaded)` : ""}.
              </p>
            )}
          </>
        ) : (
          <p style={{ color: "var(--text-secondary)", fontSize: ".9rem" }}>No games on file yet for {team.name} this season.</p>
        )}
      </main>
      <Footer />
    </>
  );
}
