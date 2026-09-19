import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getTeam,
  getLatestGame,
  getRecentForm,
  getRecentResults,
  getDivisionStandings,
  getStatLeaders,
} from "@/lib/homepage-data";
import { formatGameDate } from "@/lib/format-date";
import { Masthead, Footer } from "@/components/Masthead";
import { StatLeaders } from "@/components/StatLeaders";

export const revalidate = 300;

function resultLabel(teamScore: number, oppScore: number, gameEndType: string) {
  if (teamScore > oppScore) return gameEndType === "regulation" ? "W" : gameEndType === "overtime" ? "W (OT)" : "W (SO)";
  if (gameEndType === "overtime") return "OTL";
  if (gameEndType === "shootout") return "SOL";
  return "L";
}

export default async function TeamDetail({ params }: { params: Promise<{ abbrev: string }> }) {
  const { abbrev: rawAbbrev } = await params;
  const abbrev = rawAbbrev.toUpperCase();

  const team = await getTeam(abbrev);
  if (!team) notFound();

  // Same "whatever season is actually loaded" pattern as the homepage —
  // naturally shows the most recently completed season right now, and
  // picks up the new season's games automatically as soon as they're
  // backfilled, no code change required when that happens. Deliberately
  // no blending or fallback logic on top of that: the real current-season
  // record and stat leaders are shown as-is, whatever the sample size —
  // that's exactly what a real hockey site does in October, and a
  // synthetic "blended" number is less honest than the real one, not more.
  const [game, form, recentResults, standings, statLeaders] = await Promise.all([
    getLatestGame(abbrev),
    getRecentForm(abbrev),
    getRecentResults(abbrev),
    getDivisionStandings(abbrev),
    getStatLeaders(abbrev),
  ]);

  const isHome = game?.home_abbrev === abbrev;
  const bosScore = isHome ? game?.home_score : game?.away_score;
  const oppScore = isHome ? game?.away_score : game?.home_score;
  const opponent = isHome ? game?.away_abbrev : game?.home_abbrev;
  const won = bosScore > oppScore;

  const ownStanding = standings?.teams.find((t) => t.abbrev === abbrev) ?? null;

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

      <main style={{ maxWidth: 1160, margin: "0 auto", padding: "3rem 24px 3.5rem" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.4rem,5.5vw,4rem)", lineHeight: 0.98, textTransform: "uppercase", letterSpacing: ".01em", margin: "0 0 2rem" }}>
          {team.name}
        </h1>

        {game && (
          <section style={{ marginBottom: "2.5rem", paddingBottom: "2rem", borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-secondary)", display: "block", marginBottom: ".6rem", fontSize: ".9rem" }}>
              {game.game_type === "playoff" ? "Playoff — Final" : "Final"} · {formatGameDate(game.game_date, true)}
            </span>
            <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(1.6rem,3.5vw,2.2rem)", lineHeight: 1, textTransform: "uppercase", margin: "0 0 1rem" }}>
              <Link href={`/games/${game.id}`} style={{ color: "inherit", textDecoration: "none" }}>
                {game.headline ?? `${abbrev} ${won ? "beat" : "fell to"} ${opponent}, ${bosScore}-${oppScore}`}
              </Link>
            </h2>
            {game.body && (
              <p style={{ fontFamily: "var(--font-editorial)", fontStyle: "italic", fontSize: "1.05rem", color: "var(--text-secondary)", maxWidth: 600, lineHeight: 1.5, margin: 0 }}>
                &ldquo;{game.body}&rdquo;
              </p>
            )}
          </section>
        )}

        {standings && ownStanding && (
          <div className="stat-strip" style={{ margin: "0 0 2.5rem" }}>
            <div style={{ padding: "1.5rem 1.75rem" }}>
              <div style={{ fontSize: ".78rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>Record</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "2.2rem" }}>
                {ownStanding.wins}-{ownStanding.losses}-{ownStanding.ot_losses}
              </div>
            </div>
            <div style={{ padding: "1.5rem 1.75rem" }}>
              <div style={{ fontSize: ".78rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>Points</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "2.2rem" }}>
                {ownStanding.points}{" "}
                <span style={{ fontSize: "1.1rem", color: "var(--gold)" }}>
                  {ownStanding.division_rank === 1 ? "1st" : `#${ownStanding.division_rank}`}, {standings.division}
                </span>
              </div>
            </div>
            <div style={{ padding: "1.5rem 1.75rem" }}>
              <div style={{ fontSize: ".78rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>Streak</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "2.2rem" }}>
                {streakLen ? `${streakLen.result}${streakLen.n}` : "—"}
              </div>
            </div>
            <div style={{ padding: "1.5rem 1.75rem" }}>
              <div style={{ fontSize: ".78rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>Ask About {abbrev}</div>
              <Link href="/ask" style={{ fontSize: ".95rem", color: "var(--gold)", textDecoration: "none", fontWeight: 600 }}>
                Ask Causeway →
              </Link>
            </div>
          </div>
        )}

        {recentResults.length > 0 && (
          <section style={{ marginBottom: "2.5rem" }}>
            <h2 style={{ margin: "0 0 1rem", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.5rem", textTransform: "uppercase", letterSpacing: ".02em" }}>Recent Results</h2>
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
                    <span style={{ fontSize: ".88rem", fontWeight: 700 }}>{abbrev}</span>
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
                      background: t.abbrev === abbrev ? "rgba(255,184,28,0.08)" : "transparent",
                      borderLeft: t.abbrev === abbrev ? "3px solid var(--gold)" : "3px solid transparent",
                      color: t.abbrev === abbrev ? "var(--text-primary)" : "var(--text-secondary)",
                      fontWeight: t.abbrev === abbrev ? 700 : 400,
                    }}
                  >
                    <span style={{ color: t.abbrev === abbrev ? "var(--gold)" : "inherit" }}>{t.division_rank}</span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 8 }}>{t.name}</span>
                    <span>{t.wins}</span>
                    <span>{t.losses}</span>
                    <span className="standings-col-otl">{t.ot_losses}</span>
                    <span style={{ color: t.abbrev === abbrev ? "var(--gold)" : "inherit", fontWeight: 700 }}>{t.points}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {statLeaders && <StatLeaders abbrev={abbrev} statLeaders={statLeaders} />}
        </div>
      </main>

      <Footer />
    </>
  );
}
