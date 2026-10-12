import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeam } from "@/lib/homepage-data";
import { getLeagueComparisonSeason, getLeagueTeamStats, rankTeam, type LeagueTeamStats } from "@/lib/league-data";
import { LEAGUE_METRICS, ordinal, type LeagueMetric } from "@/lib/league-metrics";
import { formatSeasonLabel } from "@/lib/format-date";
import { Masthead, Footer } from "@/components/Masthead";
import { TeamSubNav } from "@/components/TeamSubNav";

export const revalidate = 300;

// No pages prebuilt at deploy; each renders on its first visit and is then
// cached for the revalidate period above. A route with a [param] segment
// ignores revalidate unless this is declared (found 2026-10-02: every
// team page was rendering from scratch on every visit, 0.5-0.9 s).
export async function generateStaticParams() {
  return [];
}

// The whole tile links to the stat's full league table.
function RankCard({ m, teams, abbrev }: { m: LeagueMetric; teams: LeagueTeamStats[]; abbrev: string }) {
  const { label, value: metric, higherIsBetter, format } = m;
  const rank = rankTeam(teams, abbrev, metric, higherIsBetter);
  if (!rank) return null;

  const range = rank.max - rank.min || 1;
  // Every track runs worst (left) to best (right), so a longer gold bar
  // always means better. It used to read min-to-max literally, which made
  // "against" stats backwards: 30th-of-32 in expected goals against drew
  // a nearly full gold bar that read at a glance as a strength.
  const worst = higherIsBetter ? rank.min : rank.max;
  const best = higherIsBetter ? rank.max : rank.min;
  const position = (v: number) => (higherIsBetter ? (v - rank.min) / range : (rank.max - v) / range) * 100;
  const teamPct = position(rank.value);
  const avgPct = position(rank.leagueAvg);
  const third = rank.rank <= rank.outOf / 3 ? "top" : rank.rank > (2 * rank.outOf) / 3 ? "bottom" : "middle";

  return (
    <Link href={`/teams/${abbrev}/league/${m.slug}`} className="rank-card" aria-label={`${label}: ${abbrev} ${rank.tied ? "tied " : ""}${ordinal(rank.rank)} of ${rank.outOf}. See every team.`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <span style={{ fontSize: ".78rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: "1.3rem" }}>
          {format(rank.value)}{" "}
          <span style={{ fontSize: ".95rem", color: third === "top" ? "var(--win)" : third === "bottom" ? "var(--loss)" : "var(--gold)" }}>
            {rank.tied ? "T-" : ""}{ordinal(rank.rank)} of {rank.outOf}
          </span>
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
        <span>
          {format(worst)} worst · {rank.worstTeam}
        </span>
        <span>league avg {format(rank.leagueAvg)}</span>
        <span>
          {rank.bestTeam} · best {format(best)}
        </span>
      </div>
      <div className="rank-card-more">See all {rank.outOf} teams →</div>
    </Link>
  );
}

export default async function TeamLeagueComparison({ params }: { params: Promise<{ abbrev: string }> }) {
  const { abbrev: rawAbbrev } = await params;
  const abbrev = rawAbbrev.toUpperCase();

  const team = await getTeam(abbrev);
  if (!team) notFound();

  const { seasonId, pending } = await getLeagueComparisonSeason();
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


  return (
    <>
      <Masthead />
      <main style={{ maxWidth: 1160, margin: "0 auto", padding: "1.5rem 24px 3.5rem" }}>
        <TeamSubNav abbrev={abbrev} />
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.2rem,4.5vw,3rem)", textTransform: "uppercase", letterSpacing: ".01em", margin: "0 0 .4rem" }}>
          League Ranks
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: ".9rem", marginBottom: "2rem" }}>
          {seasonId
            ? `${formatSeasonLabel(seasonId)} regular season${pending ? " · final" : ""} · vs. all ${teams.length} NHL teams`
            : "No season loaded yet"}
        </p>
        {pending && (
          <p style={{ fontSize: ".85rem", color: "var(--text-secondary)", margin: "-1.25rem 0 2rem", maxWidth: "70ch" }}>
            The {formatSeasonLabel(pending.seasonId)} comparison starts once every team has played — {pending.teamsPlayed} of {pending.teamsTotal} so far.
            Until then, rankings against a partial league wouldn&apos;t mean what they say.
          </p>
        )}

        {own ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginBottom: specialTeamsReady ? 14 : 0 }}>
              {LEAGUE_METRICS.filter((m) => m.group === "results").map((m) => <RankCard key={m.slug} m={m} teams={teams} abbrev={abbrev} />)}
            </div>

            {specialTeamsReady ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginBottom: xgReady ? 14 : 0 }}>
                {LEAGUE_METRICS.filter((m) => m.group === "special").map((m) => <RankCard key={m.slug} m={m} teams={teams} abbrev={abbrev} />)}
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
                  {LEAGUE_METRICS.filter((m) => m.group === "xg").map((m) => <RankCard key={m.slug} m={m} teams={teams} abbrev={abbrev} />)}
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
