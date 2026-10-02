import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeam } from "@/lib/homepage-data";
import { getPlayoffHistory, roundLabel } from "@/lib/playoff-data";
import { getHistoricalPlayoffSeries } from "@/lib/history-data";

// One shape for both sources: the site's playoff tables (2007-08 on) and
// the history before that (era-correct round names, ties, total-goals
// series, opponents linked only if the same club still exists).
type Series = {
  seasonId: string;
  round: number;
  label: string;
  opponentAbbrev: string;
  opponentName: string;
  linkable: boolean;
  won: boolean;
  teamWins: number;
  opponentWins: number;
  ties: number;
  decidedOnGoals: boolean;
  isFinal: boolean;
  games: { id: number; teamScore: number; oppScore: number; end: string }[];
};
import { formatSeasonLabel } from "@/lib/format-date";
import { Masthead, Footer } from "@/components/Masthead";
import { TeamSubNav } from "@/components/TeamSubNav";

export const revalidate = 300;

export default async function TeamPlayoffs({ params }: { params: Promise<{ abbrev: string }> }) {
  const { abbrev: rawAbbrev } = await params;
  const abbrev = rawAbbrev.toUpperCase();

  const team = await getTeam(abbrev);
  if (!team) notFound();

  const [modern, older] = await Promise.all([getPlayoffHistory(abbrev), getHistoricalPlayoffSeries(team.id)]);
  const history: Series[] = [
    ...older.map((r) => ({ ...r, label: r.roundName, linkable: r.opponentLinkable, isFinal: r.round === r.maxRoundThatSeason })),
    ...modern.map((r) => ({ ...r, label: roundLabel(r.round, r.maxRoundThatSeason), linkable: true, ties: 0, decidedOnGoals: false, isFinal: r.round === r.maxRoundThatSeason })),
  ];

  const bySeasson = new Map<string, Series[]>();
  for (const r of history) {
    if (!bySeasson.has(r.seasonId)) bySeasson.set(r.seasonId, []);
    bySeasson.get(r.seasonId)!.push(r);
  }
  const seasons = [...bySeasson.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  const firstSeason = seasons.at(-1)?.[0];

  const seriesWon = history.filter((r) => r.won).length;
  const seriesLost = history.filter((r) => !r.won).length;
  // A Stanley Cup: won the final round, from 1926-27 on (before that the
  // NHL champion still played another league for the Cup).
  const titles = history.filter((r) => r.won && r.isFinal && r.seasonId >= "19261927").length;

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
          {seasons.length} playoff appearances.
        </p>

        {history.length === 0 ? (
          <p style={{ color: "var(--text-secondary)", fontSize: ".9rem" }}>No playoff series on file yet for {team.name}.</p>
        ) : (
          <>
            <div className="card-row" style={{ marginBottom: "2.5rem" }}>
              <StatTile label="Series Won" value={seriesWon} />
              <StatTile label="Series Lost" value={seriesLost} />
              <StatTile label="Stanley Cups" value={titles} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {seasons.map(([seasonId, rounds]) => {
                const sorted = [...rounds].sort((a, b) => (a.games[0]?.id ?? 0) - (b.games[0]?.id ?? 0)); // play order (two series can share a round number)
                const furthest = sorted[sorted.length - 1];
                const wentAllTheWay = furthest.won && furthest.isFinal;
                return (
                  <div key={seasonId} style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.25rem 1.5rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                      <span style={{ fontFamily: "var(--font-display)", fontSize: "1.3rem", textTransform: "uppercase" }}>{formatSeasonLabel(seasonId)}</span>
                      <span style={{ fontSize: ".85rem", fontWeight: 700, color: wentAllTheWay ? "var(--gold)" : "var(--text-secondary)" }}>
                        {wentAllTheWay ? (seasonId >= "19261927" ? "Won the Stanley Cup" : "Won the NHL title") : furthest.won ? `Won the ${furthest.label}` : `Lost in the ${furthest.label}`}
                      </span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {sorted.map((r) => (
                        <div key={`${r.round}-${r.games[0]?.id ?? r.opponentAbbrev}`} style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", rowGap: 6, fontSize: ".88rem", padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                          <span style={{ color: "var(--text-secondary)" }}>{r.label}</span>
                          <span>
                            {r.linkable ? (
                              <Link href={`/teams/${r.opponentAbbrev}`} style={{ color: "var(--text-primary)", textDecoration: "none" }}>
                                {r.won ? "beat" : "lost to"} {r.opponentName}
                              </Link>
                            ) : (
                              <span style={{ color: "var(--text-primary)" }}>
                                {r.won ? "beat" : "lost to"} {r.opponentName}
                              </span>
                            )}
                          </span>
                          <span style={{ fontWeight: 700, color: r.won ? "var(--win)" : "var(--loss)" }} title={r.decidedOnGoals ? "Decided on total goals" : undefined}>
                            {r.teamWins}-{r.opponentWins}
                            {r.ties ? `-${r.ties}` : ""}
                            {r.decidedOnGoals ? " (goals)" : ""}
                          </span>
                          {/* Every game of the series, linked. */}
                          <span style={{ flexBasis: "100%", display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {r.games.map((g, i) => {
                              const won = g.teamScore > g.oppScore;
                              const tie = g.teamScore === g.oppScore;
                              return (
                                <Link
                                  key={g.id}
                                  href={`/games/${g.id}`}
                                  style={{ fontSize: ".72rem", padding: "2px 8px", borderRadius: 999, border: "1px solid var(--border)", textDecoration: "none", color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}
                                >
                                  G{i + 1} <span style={{ fontWeight: 700, color: won ? "var(--win)" : tie ? "var(--text-secondary)" : "var(--loss)" }}>{won ? "W" : tie ? "T" : "L"}</span> {g.teamScore}-{g.oppScore}
                                  {g.end === "overtime" ? " OT" : ""}
                                </Link>
                              );
                            })}
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
