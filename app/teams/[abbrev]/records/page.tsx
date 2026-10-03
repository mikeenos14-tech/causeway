import Link from "next/link";
import { scheduleHref } from "@/lib/season-path";
import { notFound } from "next/navigation";
import { getTeam } from "@/lib/homepage-data";
import { getAllRegularSeasonResults, longestWinStreak, longestPointStreak, biggestWin, worstLoss, bestAndWorstMonth } from "@/lib/records-data";
import { formatGameDate, formatSeasonLabel } from "@/lib/format-date";
import { Masthead, Footer } from "@/components/Masthead";
import { TeamSubNav } from "@/components/TeamSubNav";
import { TeamLogo } from "@/components/TeamLogo";

export const revalidate = 300;

// No pages prebuilt at deploy; each renders on its first visit and is then
// cached for the revalidate period above. A route with a [param] segment
// ignores revalidate unless this is declared (found 2026-10-02: every
// team page was rendering from scratch on every visit, 0.5-0.9 s).
export async function generateStaticParams() {
  return [];
}

const LINK = { color: "var(--text-secondary)", textDecoration: "underline", textDecorationColor: "var(--border)", textUnderlineOffset: 3 };

// Every record points at the games behind it.
function RecordTile({ label, value, sub, href }: { label: string; value: React.ReactNode; sub?: React.ReactNode; href?: string }) {
  const body = (
    <>
      <div style={{ fontSize: ".72rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: ".4rem" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "2rem", color: "var(--gold)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: ".78rem", color: "var(--text-secondary)", marginTop: 4 }}>{sub}</div>}
    </>
  );
  const box = { background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 10, padding: "1.1rem 1.2rem" };
  return href ? (
    <Link href={href} style={{ ...box, display: "block", textDecoration: "none", color: "inherit" }}>
      {body}
    </Link>
  ) : (
    <div style={box}>{body}</div>
  );
}

function StreakDates({ streak }: { streak: { startDate: string | Date; endDate: string | Date; startId: number; endId: number } }) {
  return (
    <>
      <Link href={`/games/${streak.startId}`} style={LINK}>
        {formatGameDate(streak.startDate, true)}
      </Link>{" "}
      –{" "}
      <Link href={`/games/${streak.endId}`} style={LINK}>
        {formatGameDate(streak.endDate, true)}
      </Link>
    </>
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
      <main style={{ maxWidth: 1160, margin: "0 auto", padding: "1.5rem 24px 3.5rem" }}>
        <TeamSubNav abbrev={abbrev} />
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.2rem,4.5vw,3rem)", textTransform: "uppercase", letterSpacing: ".01em", margin: "0 0 .4rem" }}>
          Records &amp; Streaks
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: ".9rem", marginBottom: "2rem" }}>
          {results.length > 0
            ? `Regular season since ${formatSeasonLabel(String(results[0].season_id))} · ${results.length.toLocaleString()} games on file. Franchise history before then isn't loaded yet, so these aren't all-time records.`
            : "No games on file yet."}
        </p>

        <div className="card-row" style={{ marginBottom: "2.5rem" }}>
          {winStreak && (
            <RecordTile
              label="Longest Win Streak"
              value={winStreak.length}
              sub={<StreakDates streak={winStreak} />}
            />
          )}
          {pointStreak && (
            <RecordTile
              label="Longest Point Streak"
              value={pointStreak.length}
              sub={<StreakDates streak={pointStreak} />}
            />
          )}
          {bigWin && (
            <RecordTile
              label="Biggest Win"
              value={`${bigWin.team_score}-${bigWin.opp_score}`}
              href={`/games/${bigWin.id}`}
              sub={<>vs <TeamLogo abbrev={bigWin.opp_abbrev} size={16} gap={3} />{bigWin.opp_abbrev} · {formatGameDate(bigWin.game_date, true)}</>}
            />
          )}
          {badLoss && (
            <RecordTile
              label="Worst Loss"
              value={`${badLoss.team_score}-${badLoss.opp_score}`}
              href={`/games/${badLoss.id}`}
              sub={<>vs <TeamLogo abbrev={badLoss.opp_abbrev} size={16} gap={3} />{badLoss.opp_abbrev} · {formatGameDate(badLoss.game_date, true)}</>}
            />
          )}
        </div>

        <div className="card-row">
          {bestMonth && (
            <RecordTile
              label="Best Month"
              value={`${bestMonth.wins}-${bestMonth.losses}-${bestMonth.otl}`}
              href={abbrev === "BOS" ? scheduleHref(bestMonth.seasonId) : undefined}
              sub={`${bestMonth.label} · ${bestMonth.points} pts in ${bestMonth.games} games`}
            />
          )}
          {worstMonth && (
            <RecordTile
              label="Worst Month"
              value={`${worstMonth.wins}-${worstMonth.losses}-${worstMonth.otl}`}
              href={abbrev === "BOS" ? scheduleHref(worstMonth.seasonId) : undefined}
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
