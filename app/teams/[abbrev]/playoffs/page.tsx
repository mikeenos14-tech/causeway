import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeam } from "@/lib/homepage-data";
import { getPlayoffHistory, getFirstLoadedSeasonId, roundLabel, type PlayoffSeriesResult } from "@/lib/playoff-data";
import { formatSeasonLabel } from "@/lib/format-date";
import { Masthead, Footer } from "@/components/Masthead";
import { TeamSubNav } from "@/components/TeamSubNav";

export const revalidate = 300;

export default async function TeamPlayoffs({ params }: { params: Promise<{ abbrev: string }> }) {
  const { abbrev: rawAbbrev } = await params;
  const abbrev = rawAbbrev.toUpperCase();

  const team = await getTeam(abbrev);
  if (!team) notFound();

  const history = await getPlayoffHistory(abbrev);

  const bySeasson = new Map<string, PlayoffSeriesResult[]>();
  for (const r of history) {
    if (!bySeasson.has(r.seasonId)) bySeasson.set(r.seasonId, []);
    bySeasson.get(r.seasonId)!.push(r);
  }
  const seasons = [...bySeasson.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  const seriesWon = history.filter((r) => r.won).length;
  const seriesLost = history.filter((r) => !r.won).length;
  const titles = history.filter((r) => r.won && r.round === r.maxRoundThatSeason).length;
  // Scope comes from the data, not a hardcoded year: the earliest season we
  // have any games for. "Championships: 1" on its own read as all-time for
  // a six-Cup franchise.
  const firstSeason = await getFirstLoadedSeasonId();

  return (
    <>
      <Masthead />
      <main style={{ maxWidth: 1160, margin: "0 auto", padding: "1.5rem 24px 3.5rem" }}>
        <TeamSubNav abbrev={abbrev} />
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.2rem,4.5vw,3rem)", textTransform: "uppercase", letterSpacing: ".01em", margin: "0 0 .4rem" }}>
          Playoff History
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: ".9rem", marginBottom: "2rem" }}>
          {firstSeason ? `Every series since ${formatSeasonLabel(firstSeason)} · ` : ""}
          {seasons.length} playoff appearances. Franchise history before then isn&apos;t loaded yet.
        </p>

        {history.length === 0 ? (
          <p style={{ color: "var(--text-secondary)", fontSize: ".9rem" }}>No playoff series on file yet for {team.name}.</p>
        ) : (
          <>
            <div className="card-row" style={{ marginBottom: "2.5rem" }}>
              <StatTile label="Series Won" value={seriesWon} />
              <StatTile label="Series Lost" value={seriesLost} />
              <StatTile label={firstSeason ? `Cups since ${formatSeasonLabel(firstSeason)}` : "Stanley Cups"} value={titles} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {seasons.map(([seasonId, rounds]) => {
                const sorted = [...rounds].sort((a, b) => a.round - b.round);
                const furthest = sorted[sorted.length - 1];
                const wentAllTheWay = furthest.won && furthest.round === furthest.maxRoundThatSeason;
                return (
                  <div key={seasonId} style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.25rem 1.5rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                      <span style={{ fontFamily: "var(--font-display)", fontSize: "1.3rem", textTransform: "uppercase" }}>{formatSeasonLabel(seasonId)}</span>
                      <span style={{ fontSize: ".85rem", fontWeight: 700, color: wentAllTheWay ? "var(--gold)" : "var(--text-secondary)" }}>
                        {wentAllTheWay ? "Won the Final" : `Lost in the ${roundLabel(furthest.round, furthest.maxRoundThatSeason)}`}
                      </span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {sorted.map((r) => (
                        <div key={r.round} style={{ display: "flex", justifyContent: "space-between", fontSize: ".88rem", padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                          <span style={{ color: "var(--text-secondary)" }}>{roundLabel(r.round, r.maxRoundThatSeason)}</span>
                          <span>
                            <Link href={`/teams/${r.opponentAbbrev}`} style={{ color: "var(--text-primary)", textDecoration: "none" }}>
                              {r.won ? "beat" : "lost to"} {r.opponentName}
                            </Link>
                          </span>
                          <span style={{ fontWeight: 700, color: r.won ? "var(--win)" : "var(--loss)" }}>
                            {r.teamWins}-{r.opponentWins}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 10, padding: "1.1rem 1.2rem" }}>
      <div style={{ fontSize: ".72rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: ".4rem" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "2rem", color: "var(--gold)", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
    </div>
  );
}
