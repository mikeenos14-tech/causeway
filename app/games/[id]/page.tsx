import Link from "next/link";
import { notFound } from "next/navigation";
import { getGameDetail, getGameSkaters, getGameGoalies } from "@/lib/game-detail-data";
import { formatGameDate } from "@/lib/format-date";
import { Masthead, Footer } from "@/components/Masthead";

function toi(seconds: number | null) {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default async function GameDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gameId = Number(id);
  if (!Number.isInteger(gameId)) notFound();

  const game = await getGameDetail(gameId);
  if (!game) notFound();

  const [skaters, goalies] = await Promise.all([getGameSkaters(gameId), getGameGoalies(gameId)]);

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
        </section>

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
