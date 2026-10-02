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
import { hasFullCareerLoaded } from "@/lib/significance-checks";
import { formatGameDate, formatSeasonLabel } from "@/lib/format-date";
import { Masthead, Footer } from "@/components/Masthead";
import { Sparkline } from "@/components/Sparkline";
import { LEADERSHIP } from "@/lib/leadership";
import { getClubSeason } from "@/lib/nhl-schedule";
import { TeamLogo } from "@/components/TeamLogo";
import { Headshot } from "@/components/Headshot";
import { getHeadshots } from "@/lib/headshots";
import { formatSavePct } from "@/lib/util/save-pct";

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
  const [totals, playoffTotals, seasonSplits, gameLog] = await Promise.all([
    isGoalie ? getGoalieCareerTotals(playerId) : getSkaterCareerTotals(playerId),
    isGoalie ? getGoalieCareerTotals(playerId, "playoff") : getSkaterCareerTotals(playerId, "playoff"),
    isGoalie ? getGoalieSeasonSplits(playerId) : getSkaterSeasonSplits(playerId),
    getRecentGameLog(playerId, isGoalie),
  ]);

  // Reuses the exact guard from the significance checks — a "career total"
  // is only an honest claim if we can verify we have this player's whole
  // career loaded, not just what happens to be in this database.
  const fullCareer = hasFullCareerLoaded(player.birth_date);
  // The team of the player's most recent game (the log is newest first).
  const latestTeam: string | undefined = gameLog[0]?.team_abbrev ?? seasonSplits.at(-1)?.team_abbrev;

  // One value per season for the career-trajectory sparkline — a mid-season
  // trade already gets its own row per team in the table above, but a trend
  // line reads as one point per season, so trade years get combined back
  // into a single season total here (points summed; save% properly
  // re-weighted by shots against, not just averaged team to team).
  const seasonIds = [...new Set(seasonSplits.map((s) => s.season_id))];
  const careerTrend = seasonIds.map((seasonId) => {
    const rowsThisSeason = seasonSplits.filter((s) => s.season_id === seasonId);
    if (isGoalie) {
      const saves = rowsThisSeason.reduce((sum, r) => sum + (r as { saves: number }).saves, 0);
      const shotsAgainst = rowsThisSeason.reduce((sum, r) => sum + (r as { shots_against: number }).shots_against, 0);
      return shotsAgainst > 0 ? saves / shotsAgainst : 0;
    }
    return rowsThisSeason.reduce((sum, r) => sum + (r as { points: number }).points, 0);
  });

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
            {fullCareer ? "Career Totals" : "Totals Since 2007-08"}
            <span style={{ fontSize: ".8rem", color: "var(--text-secondary)", marginLeft: ".6rem", letterSpacing: ".04em" }}>Regular season</span>
          </h2>
          {!fullCareer && (
            <p style={{ fontSize: ".82rem", color: "var(--text-secondary)", marginBottom: "1rem", maxWidth: "60ch" }}>
              Not labeled as a career total — we can&apos;t verify this player&apos;s entire NHL history is loaded (no birth date on file, or he could plausibly have played before our data begins).
            </p>
          )}
          <div className="card-row" style={{ marginTop: "1rem" }}>
            {isGoalie ? (
              <>
                <StatTile label="Games" value={totals.games} />
                <StatTile label="Wins" value={totals.wins} />
                <StatTile label="Losses" value={totals.losses} />
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
              {careerTrend.length > 1 && (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: ".7rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em" }}>
                    {isGoalie ? "SV% by season" : "Points by season"}
                  </span>
                  <Sparkline values={careerTrend} />
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
                        <Link href={`/teams/${s.team_abbrev}`} style={{ color: "inherit", whiteSpace: "nowrap" }}>
                          <TeamLogo abbrev={s.team_abbrev} size={18} gap={4} />
                          {s.team_abbrev}
                        </Link>
                      </td>
                      <td>{s.games}</td>
                      {isGoalie ? (
                        <>
                          <td>{s.wins}</td>
                          <td>{s.losses}</td>
                          <td>{s.otl}</td>
                          <td>{s.shutouts}</td>
                          <td style={{ fontWeight: 700, color: "var(--gold)" }}>{formatSavePct(s.savePct)}</td>
                        </>
                      ) : (
                        <>
                          <td>{s.goals}</td>
                          <td>{s.assists}</td>
                          <td style={{ fontWeight: 700, color: "var(--gold)" }}>{s.points}</td>
                          <td>{s.plus_minus > 0 ? `+${s.plus_minus}` : s.plus_minus}</td>
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

function toi(seconds: number) {
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
