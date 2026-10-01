import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getGameDetail, getGameSkaters, getGameGoalies, getGameTeamLines, getTeamName, type TeamGameLine } from "@/lib/game-detail-data";
import { AskAboutGame, gameQuestions } from "@/components/AskAboutGame";
import { getSeasonSeriesAsOfGame, getPlayoffSeriesForGame } from "@/lib/season-series-data";
import { roundLabel } from "@/lib/playoff-data";
import { TARGET_TEAM_ABBREV } from "@/lib/significance-checks";
import { formatGameDate } from "@/lib/format-date";
import { Masthead, Footer } from "@/components/Masthead";
import { GamePreview } from "@/components/GamePreview";
import { getPreview } from "@/lib/preview-data";

function toi(seconds: number | null) {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// The text half of a shared game link (the image is opengraph-image.tsx):
// "NYR 0, BOS 3 · Swayman shuts out Rangers" and the recap's first lines.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const gameId = Number((await params).id);
  if (!Number.isInteger(gameId)) return {};
  const game = await getGameDetail(gameId).catch(() => null);
  if (!game) return { title: "Game preview · Causeway", openGraph: { title: "Game preview · Causeway" } };
  const score = `${game.away_abbrev} ${game.away_score}, ${game.home_abbrev} ${game.home_score}`;
  const title = game.headline ? `${score} · ${game.headline}` : `${score} · Causeway`;
  const description = game.body ?? `Box score and stats, ${formatGameDate(game.game_date, true)}.`;
  return { title, description, openGraph: { title, description }, twitter: { card: "summary_large_image", title, description } };
}

export default async function GameDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gameId = Number(id);
  if (!Number.isInteger(gameId)) notFound();

  const game = await getGameDetail(gameId);
  // Not played (or not loaded) yet: the pre-game preview at the same URL,
  // so a link to a game works before, during, and after it.
  if (!game) {
    const preview = await getPreview(gameId);
    if (!preview) notFound();
    return (
      <>
        <Masthead />
        <main style={{ maxWidth: 1160, margin: "0 auto", padding: "3rem 24px 3.5rem" }}>
          <GamePreview p={preview} />
        </main>
        <Footer />
      </>
    );
  }

  // Only shown when the Bruins are actually one of the two teams — this
  // page is a generic /games/[id] route that can show any league game,
  // but season/playoff series tracking (like the significance checks) is
  // only meaningful relative to one team's perspective.
  const bosInGame = game.home_abbrev === TARGET_TEAM_ABBREV || game.away_abbrev === TARGET_TEAM_ABBREV;

  const [skaters, goalies, seasonSeries, playoffSeries, teamLines] = await Promise.all([
    getGameSkaters(gameId),
    getGameGoalies(gameId),
    bosInGame && game.game_type === "regular" ? getSeasonSeriesAsOfGame(gameId, TARGET_TEAM_ABBREV) : Promise.resolve(null),
    bosInGame && game.game_type === "playoff" ? getPlayoffSeriesForGame(gameId, TARGET_TEAM_ABBREV) : Promise.resolve(null),
    getGameTeamLines(gameId),
  ]);
  const opponentAbbrev = game.home_abbrev === TARGET_TEAM_ABBREV ? game.away_abbrev : game.home_abbrev;
  // Follow-up questions for the Ask box: tonight's top Bruins scorer and
  // goalie against this opponent, and the head-to-head record.
  const askQuestions = bosInGame
    ? gameQuestions({
        opponent: await getTeamName(opponentAbbrev),
        skater: skaters.find((r) => r.team_abbrev === TARGET_TEAM_ABBREV && r.points > 0)?.full_name ?? null,
        goalie: goalies.find((r) => r.team_abbrev === TARGET_TEAM_ABBREV && r.toi_seconds > 0)?.full_name ?? null,
      })
    : [];
  const thisSeries = seasonSeries;
  // Head-to-head "leads" compares wins: the opponent's wins are this team's
  // regulation losses plus OT/SO losses.
  const seriesVerb = (w: number, oppW: number) => (w === oppW ? "tied" : w > oppW ? "leads" : "trails");

  // Real bug found live (2026-09-19): the old fallback headline used
  // `won = home_score !== away_score` (meaning only "not a tie") and then
  // unconditionally wrote "AWAY beat HOME" whenever that was true — so a
  // 5-2 HOME win rendered as "MTL beat BOS, 2-5", attributing the win to
  // whichever team scored less. Since this fallback only shows when there's
  // no generated narrative (most games, league-wide), this was very likely
  // wrong on the large majority of game pages across the whole site.
  // Determine the actual winner directly instead.
  const homeWon = game.home_score > game.away_score;
  const awayWon = game.away_score > game.home_score;
  const fallbackHeadline = homeWon
    ? `${game.home_abbrev} beat ${game.away_abbrev}, ${game.home_score}-${game.away_score}`
    : awayWon
      ? `${game.away_abbrev} beat ${game.home_abbrev}, ${game.away_score}-${game.home_score}`
      : `${game.home_abbrev} and ${game.away_abbrev} tied, ${game.home_score}-${game.away_score}`;

  return (
    <>
      <Masthead />

      <main style={{ maxWidth: 1160, margin: "0 auto", padding: "3rem 24px 3.5rem" }}>
        <section style={{ marginBottom: "2.5rem", paddingBottom: "2.5rem", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-secondary)", display: "block", marginBottom: ".6rem", fontSize: ".9rem" }}>
            {game.game_type === "playoff" ? "Playoff" : game.game_type === "preseason" ? "Preseason" : "Final"} ·{" "}
            {formatGameDate(game.game_date, true)}
            {game.venue ? ` · ${game.venue}` : ""}
          </span>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2rem,4.5vw,3.2rem)", lineHeight: 0.98, textTransform: "uppercase", letterSpacing: ".01em", margin: "0 0 1rem" }}>
            {game.headline ?? fallbackHeadline}
          </h1>
          {game.body && (
            <p style={{ fontFamily: "var(--font-editorial)", fontStyle: "italic", fontSize: "1.1rem", color: "var(--text-secondary)", maxWidth: "64ch", lineHeight: 1.5, margin: 0 }}>
              &ldquo;{game.body}&rdquo;
            </p>
          )}

          <div style={{ display: "flex", gap: 40, marginTop: "1.75rem" }}>
            <div>
              <div style={{ fontSize: ".78rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>{game.away_abbrev}</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "2.6rem", color: awayWon ? "var(--gold)" : "var(--text-secondary)" }}>{game.away_score}</div>
            </div>
            <div>
              <div style={{ fontSize: ".78rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>{game.home_abbrev}</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "2.6rem", color: homeWon ? "var(--gold)" : "var(--text-secondary)" }}>{game.home_score}</div>
            </div>
            {game.game_end_type !== "regulation" && (
              <div style={{ alignSelf: "flex-end", paddingBottom: 8 }}>
                <span style={{ fontSize: ".85rem", fontWeight: 700, color: "var(--gold)", textTransform: "uppercase" }}>
                  {game.game_end_type === "shootout" ? "SO" : "OT"}
                </span>
              </div>
            )}
          </div>
          <AskAboutGame title="Ask about this game" questions={askQuestions} />
        </section>

        {thisSeries && (
          <section style={{ marginBottom: "2.5rem", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.25rem 1.5rem" }}>
            <div style={{ fontSize: ".78rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>
              Season Series · after meeting {thisSeries.games}
            </div>
            <div style={{ fontSize: "1rem" }}>
              {seriesVerb(thisSeries.wins, thisSeries.losses + thisSeries.otl) === "tied"
                ? `Series tied, ${TARGET_TEAM_ABBREV} ${thisSeries.wins}-${thisSeries.losses}-${thisSeries.otl}`
                : `${TARGET_TEAM_ABBREV} ${seriesVerb(thisSeries.wins, thisSeries.losses + thisSeries.otl)} ${thisSeries.wins}-${thisSeries.losses}-${thisSeries.otl}`}
              {" "}vs {opponentAbbrev}
            </div>
            <Link href={`/teams/${TARGET_TEAM_ABBREV}/series`} style={{ fontSize: ".8rem", fontWeight: 600, color: "var(--gold)", textDecoration: "none", display: "inline-block", marginTop: 8 }}>
              Full season series →
            </Link>
          </section>
        )}

        {playoffSeries && (
          <section style={{ marginBottom: "2.5rem", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.25rem 1.5rem" }}>
            <div style={{ fontSize: ".78rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>
              Playoffs · {roundLabel(playoffSeries.round)}{playoffSeries.gameNumber ? ` · Game ${playoffSeries.gameNumber}` : ""}
            </div>
            <div style={{ fontSize: "1rem", marginBottom: 10 }}>
              {/* The series after this game: a clinching game says who won
                  it, never "trails". */}
              {playoffSeries.teamWinsAfter === 4
                ? `${TARGET_TEAM_ABBREV} wins the series ${playoffSeries.teamWinsAfter}-${playoffSeries.opponentWinsAfter} over ${playoffSeries.opponentAbbrev}`
                : playoffSeries.opponentWinsAfter === 4
                  ? `${playoffSeries.opponentAbbrev} wins the series ${playoffSeries.opponentWinsAfter}-${playoffSeries.teamWinsAfter}`
                  : playoffSeries.teamWinsAfter === playoffSeries.opponentWinsAfter
                    ? `Series tied ${playoffSeries.teamWinsAfter}-${playoffSeries.opponentWinsAfter} vs ${playoffSeries.opponentAbbrev}`
                    : `${TARGET_TEAM_ABBREV} ${playoffSeries.teamWinsAfter > playoffSeries.opponentWinsAfter ? "leads" : "trails"} ${playoffSeries.teamWinsAfter}-${playoffSeries.opponentWinsAfter} vs ${playoffSeries.opponentAbbrev}`}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {playoffSeries.games.map((g) => (
                <Link
                  key={g.id}
                  href={`/games/${g.id}`}
                  style={{
                    fontSize: ".78rem",
                    fontWeight: g.id === gameId ? 700 : 400,
                    color: g.id === gameId ? "var(--gold)" : "var(--text-secondary)",
                    textDecoration: "none",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "4px 10px",
                  }}
                >
                  G{g.gameNumber} {g.teamScore != null ? `${g.teamScore}-${g.opponentScore}` : "—"}
                </Link>
              ))}
            </div>
          </section>
        )}

        {teamLines.length === 2 && <TeamStats lines={teamLines} />}

        <div id="box-score" />
        {["away", "home"].map((side) => {
          const abbrev = side === "away" ? game.away_abbrev : game.home_abbrev;
          const teamSkaters = skaters.filter((s) => s.team_abbrev === abbrev);
          const teamGoalies = goalies.filter((g) => g.team_abbrev === abbrev);
          return (
            <section key={side} style={{ marginBottom: "2.5rem" }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".02em", fontSize: "1.5rem", marginBottom: "1rem" }}>
                {abbrev}
              </h2>
              <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem", fontVariantNumeric: "tabular-nums", minWidth: 560 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      <th style={thStyle("left")}>Player</th>
                      <th style={thStyle()}>G</th>
                      <th style={thStyle()}>A</th>
                      <th style={thStyle()}>P</th>
                      <th style={thStyle()}>SOG</th>
                      <th style={thStyle()}>Hits</th>
                      <th style={thStyle()}>+/-</th>
                      <th style={thStyle()}>PIM</th>
                      <th style={thStyle()}>TOI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamSkaters.map((s) => (
                      <tr key={s.player_id} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={tdStyle("left")}>
                          <Link href={`/players/${s.player_id}`} style={{ color: "var(--text-primary)", textDecoration: "none" }}>
                            {s.full_name}
                          </Link>
                        </td>
                        <td style={tdStyle()}>{s.goals}</td>
                        <td style={tdStyle()}>{s.assists}</td>
                        <td style={{ ...tdStyle(), fontWeight: 700, color: "var(--gold)" }}>{s.points}</td>
                        <td style={tdStyle()}>{s.shots ?? "—"}</td>
                        <td style={tdStyle()}>{s.hits ?? "—"}</td>
                        <td style={tdStyle()}>{s.plus_minus ?? "—"}</td>
                        <td style={tdStyle()}>{s.penalty_minutes ?? "—"}</td>
                        <td style={tdStyle()}>{toi(s.toi_seconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {teamGoalies.length > 0 && (
                <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", overflowX: "auto", marginTop: "1rem" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem", fontVariantNumeric: "tabular-nums", minWidth: 480 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        <th style={thStyle("left")}>Goalie</th>
                        <th style={thStyle()}>Dec</th>
                        <th style={thStyle()}>Saves</th>
                        <th style={thStyle()}>SA</th>
                        <th style={thStyle()}>SV%</th>
                        <th style={thStyle()}>TOI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teamGoalies.map((g) => (
                        <tr key={g.player_id} style={{ borderTop: "1px solid var(--border)" }}>
                          <td style={tdStyle("left")}>
                            <Link href={`/players/${g.player_id}`} style={{ color: "var(--text-primary)", textDecoration: "none" }}>
                              {g.full_name}
                            </Link>
                            {g.shutout ? " (SO)" : ""}
                          </td>
                          <td style={tdStyle()}>{g.decision ?? "—"}</td>
                          <td style={tdStyle()}>{g.saves ?? "—"}</td>
                          <td style={tdStyle()}>{g.shots_against ?? "—"}</td>
                          <td style={tdStyle()}>{g.save_pct != null ? Number(g.save_pct).toFixed(3) : "—"}</td>
                          <td style={tdStyle()}>{toi(g.toi_seconds)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
      </main>

      <Footer />
    </>
  );
}

function thStyle(align: "left" | "right" = "right"): React.CSSProperties {
  return {
    padding: "10px 14px",
    textAlign: align,
    fontSize: ".68rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
    textTransform: "uppercase",
    letterSpacing: ".04em",
  };
}

function tdStyle(align: "left" | "right" = "right"): React.CSSProperties {
  return { padding: "10px 14px", textAlign: align, color: "var(--text-secondary)" };
}

// Team totals side by side (away | stat | home). Only rows with data for
// both teams render — the boxscore group isn't loaded for every season,
// and a missing value must never show as 0.
function TeamStats({ lines }: { lines: TeamGameLine[] }) {
  const [away, home] = lines;
  type StatRow = { label: string; a: number | null; h: number | null; fmt: (v: number, l: TeamGameLine) => string };
  const all: StatRow[] = [
    { label: "Shots on goal", a: away.shots, h: home.shots, fmt: (v) => String(v) },
    { label: "Expected goals", a: away.xg, h: home.xg, fmt: (v) => v.toFixed(2) },
    { label: "Power play", a: away.ppGoals, h: home.ppGoals, fmt: (v, l) => `${v}/${l.ppOpportunities ?? 0}` },
    { label: "Faceoffs won", a: away.faceoffPct, h: home.faceoffPct, fmt: (v) => `${Math.round(v * 100)}%` },
    { label: "Hits", a: away.hits, h: home.hits, fmt: (v) => String(v) },
  ];
  const rows = all.filter((r) => r.a != null && r.h != null);
  if (rows.length === 0) return null;
  return (
    <section style={{ marginBottom: "2.5rem", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.1rem 1.5rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", fontSize: ".78rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>
        <span>{away.abbrev}</span>
        <span>Team stats</span>
        <span style={{ textAlign: "right" }}>{home.abbrev}</span>
      </div>
      {rows.map((r) => {
        const aLead = r.a! > r.h!;
        const hLead = r.h! > r.a!;
        return (
          <div key={r.label} style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "7px 0", borderTop: "1px solid var(--border)", fontSize: ".92rem", fontVariantNumeric: "tabular-nums" }}>
            <span style={{ fontWeight: aLead ? 700 : 400, color: aLead ? "var(--text-primary)" : "var(--text-secondary)" }}>{r.fmt(r.a!, away)}</span>
            <span style={{ fontSize: ".78rem", color: "var(--text-secondary)", textAlign: "center", padding: "0 12px" }}>{r.label}</span>
            <span style={{ textAlign: "right", fontWeight: hLead ? 700 : 400, color: hLead ? "var(--text-primary)" : "var(--text-secondary)" }}>{r.fmt(r.h!, home)}</span>
          </div>
        );
      })}
      {rows.some((r) => r.label === "Expected goals") && (
        <div style={{ fontSize: ".7rem", color: "var(--text-muted)", marginTop: 6 }}>Expected goals via MoneyPuck.com.</div>
      )}
    </section>
  );
}
