import Link from "next/link";
import {
  getLatestGame,
  getRecentForm,
  getRecentResults,
  getDivisionStandings,
  getStatLeaders,
  getHomeRoadSplit,
} from "@/lib/homepage-data";
import { getLatestSeasonId } from "@/lib/schedule-data";
import { getUpcomingMilestones, milestoneText } from "@/lib/milestones-data";
import { getNextGame, nextGameFlavor } from "@/lib/next-game";
import { formatGameDate } from "@/lib/format-date";
import { Masthead, Footer } from "@/components/Masthead";
import { TeamSubNav } from "@/components/TeamSubNav";
import { StatLeaders } from "@/components/StatLeaders";
import { FormBars } from "@/components/Sparkline";

export const revalidate = 300;

const GAME_TYPE_LABEL: Record<number, string> = { 1: "Preseason", 2: "", 3: "Playoff" };

function resultLabel(teamScore: number, oppScore: number, gameEndType: string) {
  if (teamScore > oppScore) return gameEndType === "regulation" ? "W" : gameEndType === "overtime" ? "W (OT)" : "W (SO)";
  if (gameEndType === "overtime") return "OTL";
  if (gameEndType === "shootout") return "SOL";
  return "L";
}

export default async function Home() {
  const [game, form, recentResults, standings, statLeaders, nextGame, seasonId] = await Promise.all([
    getLatestGame("BOS"),
    getRecentForm("BOS"),
    getRecentResults("BOS"),
    getDivisionStandings("BOS"),
    getStatLeaders("BOS"),
    getNextGame("BOS"),
    getLatestSeasonId("BOS"),
  ]);
  const homeRoadSplit = seasonId ? await getHomeRoadSplit("BOS", seasonId) : null;
  const milestones = seasonId ? await getUpcomingMilestones("BOS", seasonId) : [];

  const isHome = game?.home_abbrev === "BOS";
  const bosScore = isHome ? game?.home_score : game?.away_score;
  const oppScore = isHome ? game?.away_score : game?.home_score;
  const opponent = isHome ? game?.away_abbrev : game?.home_abbrev;
  const won = bosScore > oppScore;

  const ownStanding = standings?.teams.find((t) => t.abbrev === "BOS") ?? null;

  const streakLen = (() => {
    if (form.length === 0) return null;
    const last = form[form.length - 1];
    let n = 0;
    for (let i = form.length - 1; i >= 0 && form[i] === last; i--) n++;
    return { result: last, n };
  })();

  return (
    <>
      <Masthead />

      <main style={{ maxWidth: 1160, margin: "0 auto", padding: "0 24px 3.5rem" }}>
        <div style={{ paddingTop: "1.25rem" }}>
          <TeamSubNav abbrev="BOS" />
        </div>
        {/* HERO */}
        {game && (
          <section style={{ padding: "4rem 0 3rem", borderBottom: "1px solid var(--border)", position: "relative", overflow: "hidden" }}>
            <div
              aria-hidden
              style={{
                position: "absolute",
                right: "-15%",
                top: "-40%",
                width: "55%",
                height: "180%",
                // "circle" alone sizes to the farthest corner, which on a
                // narrow-but-tall mobile hero (headline wraps to 3 lines,
                // pushing section height way up) makes the radius so much
                // bigger than the div's own width that the gradient barely
                // fades within it — it hits the div's rectangular edge
                // still near full opacity, reading as an abrupt hard cutoff
                // instead of a glow. closest-side sizes the circle to the
                // nearest edge instead, so the fade always completes before
                // the box boundary, on any aspect ratio.
                background: "radial-gradient(circle closest-side, rgba(255,184,28,0.09) 0%, rgba(255,184,28,0) 100%)",
                pointerEvents: "none",
              }}
            />
            <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 40, flexWrap: "wrap" }}>
              <div style={{ maxWidth: 680 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: ".75rem" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--win)", display: "inline-block" }} />
                  <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-secondary)", fontSize: ".9rem" }}>
                    {game.game_type === "playoff" ? "Playoff — Final" : "Final"} · {formatGameDate(game.game_date, true)}
                  </span>
                </div>
                <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.6rem,8vw,4.75rem)", lineHeight: 0.94, letterSpacing: ".01em", textTransform: "uppercase", margin: "0 0 1.1rem" }}>
                  <Link href={`/games/${game.id}`} style={{ color: "inherit", textDecoration: "none" }}>
                    {game.headline ?? `Bruins ${won ? "beat" : "fall to"} ${opponent}, ${bosScore}-${oppScore}`}
                  </Link>
                </h1>
                {game.body && (
                  <p style={{ fontFamily: "var(--font-editorial)", fontStyle: "italic", fontSize: "1.2rem", color: "var(--text-secondary)", maxWidth: 600, lineHeight: 1.5, margin: "0 0 1.75rem" }}>
                    &ldquo;{game.body}&rdquo;
                  </p>
                )}
                <div style={{ display: "flex", gap: 14 }}>
                  <Link
                    href={`/games/${game.id}`}
                    style={{ background: "var(--gold)", color: "var(--ink)", fontWeight: 700, fontSize: ".9rem", padding: "14px 26px", borderRadius: 8, textDecoration: "none" }}
                  >
                    Full Recap
                  </Link>
                  <Link
                    href={`/games/${game.id}#box-score`}
                    style={{ background: "transparent", color: "var(--text-primary)", fontWeight: 600, fontSize: ".9rem", padding: "14px 26px", borderRadius: 8, border: "1px solid var(--border)", textDecoration: "none" }}
                  >
                    See the box score
                  </Link>
                </div>
              </div>
              <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 16, padding: "1.75rem 2rem", minWidth: 260 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 700, fontSize: ".95rem" }}>BOS</span>
                  <span style={{ fontFamily: "var(--font-display)", fontSize: "2.8rem", color: won ? "var(--gold)" : "var(--text-secondary)" }}>{bosScore}</span>
                </div>
                <div style={{ height: 1, background: "var(--border)", margin: ".9rem 0" }} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 700, fontSize: ".95rem", color: "var(--text-secondary)" }}>{opponent}</span>
                  <span style={{ fontFamily: "var(--font-display)", fontSize: "2.8rem", color: !won ? "var(--gold)" : "var(--text-secondary)" }}>{oppScore}</span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* STAT STRIP */}
        {standings && ownStanding && (
          <div className="stat-strip" style={{ margin: "2.5rem 0" }}>
            <div style={{ padding: "1.75rem 2rem" }}>
              <div style={{ fontSize: ".78rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>Record</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "2.5rem" }}>
                {ownStanding.wins}-{ownStanding.losses}-{ownStanding.ot_losses}
              </div>
            </div>
            <div style={{ padding: "1.75rem 2rem" }}>
              <div style={{ fontSize: ".78rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>Points</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "2.5rem" }}>
                {ownStanding.points}{" "}
                <span style={{ fontSize: "1.25rem", color: "var(--gold)" }}>
                  {ownStanding.division_rank === 1 ? "1st" : `#${ownStanding.division_rank}`}, {standings.division}
                </span>
              </div>
            </div>
            <div style={{ padding: "1.75rem 2rem" }}>
              <div style={{ fontSize: ".78rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>Streak</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "2.5rem" }}>
                {streakLen ? `${streakLen.result}${streakLen.n}` : "—"}
                {streakLen && streakLen.result === "W" && streakLen.n >= 3 && (
                  <span style={{ fontSize: "1.1rem", fontFamily: "var(--font-body)", color: "var(--text-secondary)", marginLeft: 8 }}>stop us</span>
                )}
              </div>
              {form.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <FormBars results={form as ("W" | "L")[]} />
                </div>
              )}
            </div>
            <div style={{ padding: "1.75rem 2rem" }}>
              <div style={{ fontSize: ".78rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>Next Up</div>
              {nextGame ? (
                <>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: "2.5rem" }}>
                    {nextGame.isHome ? "vs" : "@"} {nextGame.opponent}
                  </div>
                  <div style={{ fontSize: ".85rem", color: "var(--text-secondary)", marginTop: 2 }}>
                    {GAME_TYPE_LABEL[nextGame.gameType] && `${GAME_TYPE_LABEL[nextGame.gameType]} · `}
                    {formatGameDate(nextGame.gameDate)}
                    {nextGameFlavor(nextGame) && ` — ${nextGameFlavor(nextGame)}`}
                  </div>
                </>
              ) : (
                <div style={{ fontFamily: "var(--font-display)", fontSize: "2.5rem", color: "var(--text-secondary)" }}>—</div>
              )}
            </div>
          </div>
        )}

        {/* ASK CAUSEWAY BAND */}
        <section
          style={{
            margin: "2.5rem 0",
            padding: "2rem 2.2rem",
            borderRadius: 16,
            background: "linear-gradient(135deg, var(--surface-1) 0%, var(--surface-2) 100%)",
            border: "1px solid rgba(255,184,28,0.22)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 32,
            flexWrap: "wrap",
          }}
        >
          <div style={{ maxWidth: 460 }}>
            <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--gold)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8 }}>Ask Causeway</div>
            <h2 style={{ margin: "0 0 6px", fontSize: "1.4rem", fontFamily: "var(--font-body)", fontWeight: 700 }}>Got a stat question? Just ask.</h2>
            <p style={{ margin: 0, fontSize: ".9rem", color: "var(--text-secondary)" }}>Full NHL history, every team, straight from the database. Every answer shows its work.</p>
          </div>
          <Link
            href="/ask"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "var(--ink)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "14px 20px",
              fontSize: ".9rem",
              color: "var(--text-secondary)",
              textDecoration: "none",
              minWidth: 280,
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2.4">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            e.g. &ldquo;Longest point streak by a Bruins player?&rdquo;
          </Link>
        </section>

        {/* RECENT RESULTS */}
        {recentResults.length > 0 && (
          <section style={{ marginBottom: "2.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "1rem" }}>
              <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.5rem", textTransform: "uppercase", letterSpacing: ".02em" }}>Recent Results</h2>
              <Link href="/schedule" style={{ fontSize: ".82rem", fontWeight: 600, color: "var(--gold)", textDecoration: "none" }}>
                Full schedule →
              </Link>
            </div>
            <div className="card-row">
              {recentResults.map((r) => (
                <Link
                  key={r.id}
                  href={`/games/${r.id}`}
                  style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 10, padding: "1rem 1.2rem", textDecoration: "none", color: "inherit" }}
                >
                  <div style={{ fontSize: ".72rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: 10 }}>
                    {formatGameDate(r.game_date)} · {resultLabel(r.team_score, r.opp_score, r.game_end_type)}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: ".88rem", fontWeight: 700 }}>BOS</span>
                    <span style={{ fontSize: ".88rem", fontWeight: 700, color: r.team_score > r.opp_score ? "var(--gold)" : "var(--text-secondary)" }}>{r.team_score}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: ".88rem", color: "var(--text-secondary)" }}>{r.opp_abbrev}</span>
                    <span style={{ fontSize: ".88rem", color: "var(--text-secondary)" }}>{r.opp_score}</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {milestones.length > 0 && (
          <section style={{ marginBottom: "2.5rem" }}>
            <h2 style={{ margin: "0 0 1rem", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.5rem", textTransform: "uppercase", letterSpacing: ".02em" }}>Milestone Watch</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {milestones.slice(0, 4).map((m) => (
                <Link
                  key={`${m.playerId}-${m.category}`}
                  href={`/players/${m.playerId}`}
                  style={{
                    background: "var(--surface-1)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: "12px 18px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    textDecoration: "none",
                    color: "var(--text-primary)",
                    fontSize: ".9rem",
                  }}
                >
                  <span>
                    <strong>{m.playerName}</strong> {milestoneText(m)}
                  </span>
                  <span style={{ color: "var(--gold)", fontWeight: 700, fontFamily: "var(--font-display)", fontSize: "1.1rem" }}>{m.current}/{m.target}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {homeRoadSplit && (homeRoadSplit.home.games > 0 || homeRoadSplit.away.games > 0) && (
          <section style={{ marginBottom: "2.5rem" }}>
            <h2 style={{ margin: "0 0 1rem", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.5rem", textTransform: "uppercase", letterSpacing: ".02em" }}>Home / Road</h2>
            <div className="card-row">
              <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 10, padding: "1.1rem 1.2rem" }}>
                <div style={{ fontSize: ".72rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: ".4rem" }}>At Home</div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "2rem", color: "var(--gold)", fontVariantNumeric: "tabular-nums" }}>
                  {homeRoadSplit.home.wins}-{homeRoadSplit.home.losses}-{homeRoadSplit.home.otl}
                </div>
                <div style={{ fontSize: ".78rem", color: "var(--text-secondary)", marginTop: 4 }}>{homeRoadSplit.home.points} pts in {homeRoadSplit.home.games} games</div>
              </div>
              <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 10, padding: "1.1rem 1.2rem" }}>
                <div style={{ fontSize: ".72rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: ".4rem" }}>On the Road</div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "2rem", color: "var(--gold)", fontVariantNumeric: "tabular-nums" }}>
                  {homeRoadSplit.away.wins}-{homeRoadSplit.away.losses}-{homeRoadSplit.away.otl}
                </div>
                <div style={{ fontSize: ".78rem", color: "var(--text-secondary)", marginTop: 4 }}>{homeRoadSplit.away.points} pts in {homeRoadSplit.away.games} games</div>
              </div>
            </div>
          </section>
        )}

        {/* STANDINGS + STAT LEADERS */}
        <div className="homepage-lower-grid">
          {standings && (
            <section>
              <h2 style={{ margin: "0 0 1rem", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.5rem", textTransform: "uppercase", letterSpacing: ".02em" }}>{standings.division}</h2>
              <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                <div className="standings-row standings-row--compact" style={{ padding: "10px 18px", fontSize: ".68rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", borderBottom: "1px solid var(--border)" }}>
                  <span>#</span><span>Team</span><span>W</span><span>L</span><span className="standings-col-otl">OTL</span><span>PTS</span>
                </div>
                {standings.teams.map((t) => (
                  <Link
                    key={t.abbrev}
                    href={`/teams/${t.abbrev}`}
                    className="standings-row standings-row--compact"
                    style={{
                      padding: "12px 18px",
                      alignItems: "center",
                      fontSize: ".88rem",
                      borderTop: "1px solid var(--border)",
                      textDecoration: "none",
                      background: t.abbrev === "BOS" ? "rgba(255,184,28,0.08)" : "transparent",
                      borderLeft: t.abbrev === "BOS" ? "3px solid var(--gold)" : "3px solid transparent",
                      color: t.abbrev === "BOS" ? "var(--text-primary)" : "var(--text-secondary)",
                      fontWeight: t.abbrev === "BOS" ? 700 : 400,
                    }}
                  >
                    <span style={{ color: t.abbrev === "BOS" ? "var(--gold)" : "inherit" }}>{t.division_rank}</span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 8 }}>{t.name}</span>
                    <span>{t.wins}</span>
                    <span>{t.losses}</span>
                    <span className="standings-col-otl">{t.ot_losses}</span>
                    <span style={{ color: t.abbrev === "BOS" ? "var(--gold)" : "inherit" }}>{t.points}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {statLeaders && <StatLeaders statLeaders={statLeaders} />}
        </div>
      </main>

      <Footer />
    </>
  );
}
