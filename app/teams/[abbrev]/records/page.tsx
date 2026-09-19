import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeam } from "@/lib/homepage-data";
import { getAllRegularSeasonResults, longestWinStreak, longestPointStreak, biggestWin, worstLoss, bestAndWorstMonth } from "@/lib/records-data";
import { formatGameDate } from "@/lib/format-date";
import { Masthead, Footer } from "@/components/Masthead";

export const revalidate = 300;

function RecordTile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 10, padding: "1.1rem 1.2rem" }}>
      <div style={{ fontSize: ".72rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: ".4rem" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "2rem", color: "var(--gold)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: ".78rem", color: "var(--text-secondary)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export default async function TeamRecords({ params }: { params: Promise<{ abbrev: string }> }) {
  const { abbrev: rawAbbrev } = await params;
  const abbrev = rawAbbrev.toUpperCase();

  const team = await getTeam(abbrev);
  if (!team) notFound();

  const results = await getAllRegularSeasonResults(abbrev);
  const winStreak = longestWinStreak(results);
  const pointStreak = longestPointStreak(results);
  const bigWin = biggestWin(results);
  const badLoss = worstLoss(results);
  const { best: bestMonth, worst: worstMonth } = bestAndWorstMonth(results);

  return (
    <>
      <Masthead />
      <main style={{ maxWidth: 1160, margin: "0 auto", padding: "3rem 24px 3.5rem" }}>
        <Link href={`/teams/${abbrev}`} style={{ fontSize: ".82rem", fontWeight: 600, color: "var(--gold)", textDecoration: "none" }}>
          ← {team.name}
        </Link>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.2rem,4.5vw,3rem)", textTransform: "uppercase", letterSpacing: ".01em", margin: ".4rem 0 .4rem" }}>
          Records &amp; Streaks
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: ".9rem", marginBottom: "2rem" }}>
          Regular season, every game on file ({results.length} games)
        </p>

        <div className="card-row" style={{ marginBottom: "2.5rem" }}>
          {winStreak && (
            <RecordTile
              label="Longest Win Streak"
              value={winStreak.length}
              sub={`${formatGameDate(winStreak.startDate, true)} – ${formatGameDate(winStreak.endDate, true)}`}
            />
          )}
          {pointStreak && (
            <RecordTile
              label="Longest Point Streak"
              value={pointStreak.length}
              sub={`${formatGameDate(pointStreak.startDate, true)} – ${formatGameDate(pointStreak.endDate, true)}`}
            />
          )}
          {bigWin && (
            <RecordTile
              label="Biggest Win"
              value={`${bigWin.team_score}-${bigWin.opp_score}`}
              sub={`vs ${bigWin.opp_abbrev} · ${formatGameDate(bigWin.game_date, true)}`}
            />
          )}
          {badLoss && (
            <RecordTile
              label="Worst Loss"
              value={`${badLoss.team_score}-${badLoss.opp_score}`}
              sub={`vs ${badLoss.opp_abbrev} · ${formatGameDate(badLoss.game_date, true)}`}
            />
          )}
        </div>

        <div className="card-row">
          {bestMonth && (
            <RecordTile
              label="Best Month"
              value={`${bestMonth.wins}-${bestMonth.losses}-${bestMonth.otl}`}
              sub={`${bestMonth.label} · ${bestMonth.points} pts in ${bestMonth.games} games`}
            />
          )}
          {worstMonth && (
            <RecordTile
              label="Worst Month"
              value={`${worstMonth.wins}-${worstMonth.losses}-${worstMonth.otl}`}
              sub={`${worstMonth.label} · ${worstMonth.points} pts in ${worstMonth.games} games`}
            />
          )}
        </div>

        {results.length === 0 && <p style={{ color: "var(--text-secondary)", fontSize: ".9rem" }}>No regular-season games on file yet.</p>}
      </main>
      <Footer />
    </>
  );
}
