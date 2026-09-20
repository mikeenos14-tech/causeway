import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeam } from "@/lib/homepage-data";
import { getPlayoffHistory, type PlayoffSeriesResult } from "@/lib/playoff-data";
import { formatSeasonLabel } from "@/lib/format-date";
import { Masthead, Footer } from "@/components/Masthead";
import { TeamSubNav } from "@/components/TeamSubNav";

export const revalidate = 300;

// Standard 4-round format, which every season in this database uses (the
// max round is always 4) — labeled relative to that season's actual max
// round rather than hardcoding "round 4 = Final", so this still reads
// correctly if a play-in or extra round ever changes that.
function roundLabel(round: number, maxRound: number): string {
  const fromEnd = maxRound - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Conference Final";
  if (fromEnd === 2) return "Second Round";
  if (fromEnd === 3) return "First Round";
  return `Round ${round}`;
}

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

  return (
    <>
      <Masthead />
      <main style={{ maxWidth: 1160, margin: "0 auto", padding: "1.5rem 24px 3.5rem" }}>
        <TeamSubNav abbrev={abbrev} />
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.2rem,4.5vw,3rem)", textTransform: "uppercase", letterSpacing: ".01em", margin: "0 0 .4rem" }}>
          Playoff History
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: ".9rem", marginBottom: "2rem" }}>
          Every series on file · {seasons.length} playoff appearances
        </p>

        {history.length === 0 ? (
          <p style={{ color: "var(--text-secondary)", fontSize: ".9rem" }}>No playoff series on file yet for {team.name}.</p>
        ) : (
          <>
            <div className="card-row" style={{ marginBottom: "2.5rem" }}>
              <StatTile label="Series Won" value={seriesWon} />
              <StatTile label="Series Lost" value={seriesLost} />
              <StatTile label="Championships" value={titles} />
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
