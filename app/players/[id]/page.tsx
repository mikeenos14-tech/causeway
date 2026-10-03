import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getPlayer,
  getSkaterCareerTotals,
  getGoalieCareerTotals,
  getSkaterSeasonSplits,
  getGoalieSeasonSplits,
  getRecentGameLog,
} from "@/lib/player-detail-data";
import { formatGameDate, formatSeasonLabel } from "@/lib/format-date";
import { Masthead, Footer } from "@/components/Masthead";
import { Sparkline } from "@/components/Sparkline";
import { LEADERSHIP } from "@/lib/leadership";
import { getClubSeason, isFinal } from "@/lib/nhl-schedule";
import { TeamLogo } from "@/components/TeamLogo";
import { Headshot } from "@/components/Headshot";
import { getHeadshots } from "@/lib/headshots";
import { formatSavePct } from "@/lib/util/save-pct";
import { buildCareerTrend, seasonByDate, MIN_GAMES } from "@/lib/career-trend";
import { skaterPace, goaliePace } from "@/lib/pace";
import { getClutchCard } from "@/lib/leverage-data";
import { ClutchCard } from "@/components/ClutchCard";

// Cached 10 minutes (stats change at most a few times a night). A [param]
// route only caches with generateStaticParams declared; none prebuilt.
export const revalidate = 600;
export async function generateStaticParams() {
  return [];
}

export default async function PlayerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playerId = Number(id);
  if (!Number.isInteger(playerId)) notFound();

  const player = await getPlayer(playerId);
  if (!player) notFound();

  const isGoalie = player.position === "G";
  const headshot = (await getHeadshots([playerId]))[playerId] ?? null;
  // Captaincy for the NHL's current season only (hand-maintained, sourced —
  // see lib/leadership.ts).
  const ledTeam = Object.entries(LEADERSHIP).find(([, l]) => l.captainId === playerId || l.alternateIds.includes(playerId));
  const ledSeason = ledTeam ? (await getClubSeason(ledTeam[0]))?.currentSeason : null;
  const role = ledTeam && ledSeason === ledTeam[1].season ? (ledTeam[1].captainId === playerId ? "Captain" : "Alternate captain") : null;
  const [totals, playoffTotals, seasonSplits, gameLog, clutch] = await Promise.all([
    isGoalie ? getGoalieCareerTotals(playerId) : getSkaterCareerTotals(playerId),
    isGoalie ? getGoalieCareerTotals(playerId, "playoff") : getSkaterCareerTotals(playerId, "playoff"),
    isGoalie ? getGoalieSeasonSplits(playerId) : getSkaterSeasonSplits(playerId),
    getRecentGameLog(playerId, isGoalie),
    isGoalie ? Promise.resolve(null) : getClutchCard(playerId).catch(() => null),
  ]);

  // Careers are complete: the NHL's history tables (1917-18 on) joined to
  // the site's (lib/player-detail-data.ts), checked against the NHL's own
  // career totals by scripts/qa/check-player-careers.ts.
  // The team of the player's most recent game (the log is newest first).
  const latestTeam: string | undefined = gameLog[0]?.team_abbrev ?? seasonSplits.at(-1)?.team_abbrev;

  // Career trend as a rate, one point per season of 10+ games; the season
  // in progress joins as a hollow "so far" point at 10 games (see
  // lib/career-trend.ts for why totals were misleading).
  const club = latestTeam ? await getClubSeason(latestTeam).catch(() => null) : null;
  const inProgressSeason = club
    ? club.games.some((g) => g.season === club.currentSeason && g.gameType === 2 && !isFinal(g))
      ? club.currentSeason
      : null
    : seasonByDate(new Date());
  const trend = buildCareerTrend(seasonSplits, isGoalie, inProgressSeason);
  // A ties column only for goalies who had any (ties ended in 2003-04).
  const hasTies = isGoalie && seasonSplits.some((r) => Number((r as { ties?: number }).ties ?? 0) > 0);

  // "On pace for" during the regular season, from 20 GP (lib/pace.ts):
  // his totals so far plus his rate over his team's remaining games.
  const pace = (() => {
    if (!club || !inProgressSeason || inProgressSeason !== club.currentSeason) return null;
    const regular = club.games.filter((g) => g.season === club.currentSeason && g.gameType === 2);
    const teamGamesPlayed = regular.filter(isFinal).length;
    const rows = seasonSplits.filter((r) => r.season_id === inProgressSeason);
    const gp = rows.reduce((sum, r) => sum + Number(r.games), 0);
    if (isGoalie) {
      // Wins per team game needs one team's games; skip a goalie traded mid-season.
      if (rows.length !== 1 || rows[0].team_abbrev !== latestTeam) return null;
      return goaliePace({ gp, wins: Number((rows[0] as { wins: number }).wins), teamGamesPlayed, seasonGames: regular.length });
    }
    const sum = (k: "goals" | "points") => rows.reduce((t, r) => t + Number((r as Record<string, unknown>)[k]), 0);
    return skaterPace({ gp, goals: sum("goals"), points: sum("points"), teamGamesPlayed, seasonGames: regular.length });
  })();
  const trendLabel = (p: (typeof trend.points)[number]) =>
    `${formatSeasonLabel(p.seasonId)}${p.inProgress ? " so far" : ""}: ${isGoalie ? `${formatSavePct(p.value)} SV%` : `${p.value.toFixed(2)} pts/game`} (${p.games} GP)`;

  return (
    <>
      <Masthead />

      <main style={{ maxWidth: 1160, margin: "0 auto", padding: "3rem 24px 3.5rem" }}>
        <section style={{ marginBottom: "2.5rem", display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap" }}>
          {/* Players on a current NHL roster only (player_headshots). */}
          {headshot && <Headshot url={headshot} name={player.full_name} size={132} zoom={1.1} eager />}
          <div style={{ minWidth: 0, flex: "1 1 280px" }}>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--gold)", display: "block", marginBottom: ".6rem", fontSize: ".9rem" }}>
              {({ C: "Center", L: "Left wing", R: "Right wing", D: "Defense", G: "Goalie" } as Record<string, string>)[player.position] ?? "Player"}
              {role && ledTeam && (
                <span style={{ marginLeft: 10, color: "var(--ink)", background: "var(--gold)", borderRadius: 4, padding: "1px 7px", fontSize: ".78rem" }}>
                  {role} · {ledTeam[0]}
                </span>
              )}
            </span>
            <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.4rem,5.5vw,4rem)", lineHeight: 0.98, textTransform: "uppercase", letterSpacing: ".01em", margin: "0 0 .6rem" }}>
              {player.full_name}
            </h1>
            {/* A way back out: the player's most recent team and its roster. */}
            {latestTeam && (
              <p style={{ margin: "0 0 .4rem", fontSize: ".9rem" }}>
                <Link href={`/teams/${latestTeam}/roster`} style={{ color: "var(--gold)", textDecoration: "none", fontWeight: 600 }}>
                  <TeamLogo abbrev={latestTeam} size={20} gap={4} />
                  {latestTeam} roster →
                </Link>
              </p>
            )}
            {player.birth_date ? (
              <p style={{ color: "var(--text-secondary)", fontSize: ".95rem" }}>
                Born {formatGameDate(player.birth_date, true)}
                {player.birth_country ? `, ${player.birth_country}` : ""}
                {/* Skaters shoot; goalies catch (the glove hand), as the NHL lists it. */}
                {player.shoots_catches ? ` · ${isGoalie ? "Catches" : "Shoots"} ${player.shoots_catches}` : ""}
              </p>
            ) : (
              <p style={{ color: "var(--text-secondary)", fontSize: ".9rem" }}>
                No bio on file — this player joined a team after that season&apos;s roster was last fetched.
              </p>
            )}
          </div>
        </section>

        <section style={{ marginBottom: "2.5rem" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".02em", fontSize: "1.4rem", marginBottom: ".2rem" }}>
            Career Totals
            <span style={{ fontSize: ".8rem", color: "var(--text-secondary)", marginLeft: ".6rem", letterSpacing: ".04em" }}>Regular season</span>
          </h2>
          <div className="card-row" style={{ marginTop: "1rem" }}>
            {isGoalie ? (
              <>
                <StatTile label="Games" value={totals.games} />
                <StatTile label="Wins" value={totals.wins} />
                <StatTile label="Losses" value={totals.losses} />
                {totals.ties > 0 && <StatTile label="Ties" value={totals.ties} />}
                <StatTile label="OT Losses" value={totals.otl} />
                <StatTile label="Shutouts" value={totals.shutouts} />
                <StatTile label="SV%" value={formatSavePct(totals.save_pct)} />
              </>
            ) : (
              <>
                <StatTile label="Games" value={totals.games} />
                <StatTile label="Goals" value={totals.goals} />
                <StatTile label="Assists" value={totals.assists} />
                <StatTile label="Points" value={totals.points} />
              </>
            )}
          </div>
          {pace && inProgressSeason && (
            <p style={{ fontSize: ".9rem", color: "var(--text-secondary)", marginTop: ".9rem" }} title={`His totals so far plus his ${pace.kind === "goalie" ? "wins per team game" : "per-game rate"} over the ${latestTeam}'s ${pace.remaining} remaining games, if he plays them all.`}>
              <span style={{ fontWeight: 600, color: "var(--gold)" }}>{formatSeasonLabel(inProgressSeason)}: </span>
              {pace.kind === "skater" ? (
                <>
                  {pace.goals} G, {pace.points} P in {pace.gp} GP · on pace for{" "}
                  <strong style={{ color: "var(--text-primary)" }}>
                    {pace.paceGoals} {pace.paceGoals === 1 ? "goal" : "goals"} and {pace.pacePoints} {pace.pacePoints === 1 ? "point" : "points"}
                  </strong>
                </>
              ) : (
                <>
                  {pace.wins} {pace.wins === 1 ? "win" : "wins"} in {pace.gp} GP · on pace for{" "}
                  <strong style={{ color: "var(--text-primary)" }}>{pace.paceWins} wins</strong>
                </>
              )}
              <span style={{ color: "var(--text-muted)", fontSize: ".8rem" }}> (at his current rate, {pace.remaining} games left)</span>
            </p>
          )}
          {playoffTotals.games > 0 && (
            <p style={{ fontSize: ".85rem", color: "var(--text-secondary)", marginTop: ".9rem" }}>
              <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>Playoffs: </span>
              {isGoalie
                ? `${playoffTotals.games} GP · ${playoffTotals.wins}-${playoffTotals.losses} · ${playoffTotals.shutouts} SO${playoffTotals.save_pct != null ? ` · ${formatSavePct(playoffTotals.save_pct)} SV%` : ""}`
                : `${playoffTotals.games} GP · ${playoffTotals.goals} G · ${playoffTotals.assists} A · ${playoffTotals.points} P`}
            </p>
          )}
        </section>

        {seasonSplits.length > 0 && (
          <section style={{ marginBottom: "2.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: 12 }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".02em", fontSize: "1.4rem", margin: 0 }}>
                Season by Season
              </h2>
              {trend.points.length > 1 && (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: ".7rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", textAlign: "right", lineHeight: 1.35 }}>
                    {isGoalie ? "SV% by season" : "Points per game"}
                    <span style={{ display: "block", fontWeight: 500, textTransform: "none", letterSpacing: 0, color: "var(--text-muted)" }}>
                      {trend.pending
                        ? `${formatSeasonLabel(trend.pending.seasonId)} joins at ${MIN_GAMES} GP`
                        : trend.points.at(-1)?.inProgress
                          ? `○ ${formatSeasonLabel(trend.points.at(-1)!.seasonId)} so far (${trend.points.at(-1)!.games} GP)`
                          : `seasons of ${MIN_GAMES}+ GP`}
                    </span>
                  </span>
                  <Sparkline values={trend.points.map((p) => p.value)} labels={trend.points.map(trendLabel)} lastHollow={!!trend.points.at(-1)?.inProgress} />
                </div>
              )}
            </div>
            <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", overflowX: "auto" }}>
              <table className="box-score-table" style={{ minWidth: isGoalie ? 480 : 680, padding: "0 18px" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Season</th>
                    <th style={{ textAlign: "left" }}>Team</th>
                    <th>GP</th>
                    {isGoalie ? (
                      <>
                        <th>W</th>
                        <th>L</th>
                        {hasTies && <th>T</th>}
                        <th>OTL</th>
                        <th>SO</th>
                        <th>SV%</th>
                      </>
                    ) : (
                      <>
                        <th>G</th>
                        <th>A</th>
                        <th>P</th>
                        <th>+/-</th>
                        <th>PIM</th>
                        <th>S%</th>
                        <th>TOI/GP</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {seasonSplits.map((s) => (
                    <tr key={`${s.season_id}-${s.team_abbrev}`}>
                      <td style={{ textAlign: "left" }}>{formatSeasonLabel(s.season_id)}</td>
                      <td style={{ textAlign: "left" }}>
                        {s.team_active ? (
                          <Link href={`/teams/${s.team_abbrev}`} style={{ color: "inherit", whiteSpace: "nowrap" }}>
                            <TeamLogo abbrev={s.team_abbrev} size={18} gap={4} />
                            {s.team_abbrev}
                          </Link>
                        ) : (
                          <span style={{ whiteSpace: "nowrap" }}>
                            <TeamLogo abbrev={s.team_abbrev} size={18} gap={4} />
                            {s.team_abbrev}
                          </span>
                        )}
                      </td>
                      <td>{s.games}</td>
                      {isGoalie ? (
                        <>
                          <td>{s.wins}</td>
                          <td>{s.losses}</td>
                          {hasTies && <td>{s.ties}</td>}
                          <td>{s.otl}</td>
                          <td>{s.shutouts}</td>
                          <td style={{ fontWeight: 700, color: "var(--gold)" }}>{formatSavePct(s.savePct)}</td>
                        </>
                      ) : (
                        <>
                          <td>{s.goals}</td>
                          <td>{s.assists}</td>
                          <td style={{ fontWeight: 700, color: "var(--gold)" }}>{s.points}</td>
                          <td>{s.plus_minus == null ? "—" : s.plus_minus > 0 ? `+${s.plus_minus}` : s.plus_minus}</td>
                          <td>{s.pim}</td>
                          <td>{s.shootingPct != null ? `${(s.shootingPct * 100).toFixed(1)}%` : "—"}</td>
                          <td>{toi(s.toiSecondsPerGame)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {clutch && <ClutchCard c={clutch} name={player.full_name} />}

        <section>
          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".02em", fontSize: "1.4rem", marginBottom: "1rem" }}>
            Recent Games
          </h2>
          <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem", fontVariantNumeric: "tabular-nums", minWidth: 540 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th style={thStyle("left")}>Date</th>
                  <th style={thStyle("left")}>Team</th>
                  <th style={thStyle("left")}>Opp</th>
                  {isGoalie ? (
                    <>
                      <th style={thStyle()}>Dec</th>
                      <th style={thStyle()}>Saves</th>
                      <th style={thStyle()}>SA</th>
                    </>
                  ) : (
                    <>
                      <th style={thStyle()}>G</th>
                      <th style={thStyle()}>A</th>
                      <th style={thStyle()}>P</th>
                      <th style={thStyle()}>TOI</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {gameLog.map((g) => (
                  <tr key={g.game_id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={tdStyle("left")}>
                      <Link href={`/games/${g.game_id}`} style={{ color: "var(--text-primary)", textDecoration: "none" }}>
                        {formatGameDate(g.game_date)}
                      </Link>
                    </td>
                    <td style={tdStyle("left")}>
                      <Link href={`/teams/${g.team_abbrev}`} style={{ color: "inherit" }}>
                        {g.team_abbrev}
                      </Link>
                    </td>
                    <td style={tdStyle("left")}>
                      {g.is_home ? "vs" : "@"}{" "}
                      <Link href={`/teams/${g.opp_abbrev}`} style={{ color: "inherit", whiteSpace: "nowrap" }}>
                        <TeamLogo abbrev={g.opp_abbrev} size={18} gap={4} />
                        {g.opp_abbrev}
                      </Link>
                    </td>
                    {isGoalie ? (
                      <>
                        <td style={tdStyle()}>{g.decision ?? "—"}</td>
                        <td style={tdStyle()}>{g.saves}</td>
                        <td style={tdStyle()}>{g.shots_against}</td>
                      </>
                    ) : (
                      <>
                        <td style={tdStyle()}>{g.goals}</td>
                        <td style={tdStyle()}>{g.assists}</td>
                        <td style={{ ...tdStyle(), fontWeight: 700, color: "var(--gold)" }}>{g.points}</td>
                        <td style={tdStyle()}>{g.toi_seconds != null ? toi(g.toi_seconds) : "—"}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}

// "—" for seasons before 2007-08, when ice time wasn't kept.
function toi(seconds: number | null) {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
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
