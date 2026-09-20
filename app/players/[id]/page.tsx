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

export default async function PlayerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playerId = Number(id);
  if (!Number.isInteger(playerId)) notFound();

  const player = await getPlayer(playerId);
  if (!player) notFound();

  const isGoalie = player.position === "G";
  const [totals, seasonSplits, gameLog] = await Promise.all([
    isGoalie ? getGoalieCareerTotals(playerId) : getSkaterCareerTotals(playerId),
    isGoalie ? getGoalieSeasonSplits(playerId) : getSkaterSeasonSplits(playerId),
    getRecentGameLog(playerId, isGoalie),
  ]);

  // Reuses the exact guard from the significance checks — a "career total"
  // is only an honest claim if we can verify we have this player's whole
  // career loaded, not just what happens to be in this database.
  const fullCareer = hasFullCareerLoaded(player.birth_date);

  return (
    <>
      <Masthead />

      <main style={{ maxWidth: 1160, margin: "0 auto", padding: "3rem 24px 3.5rem" }}>
        <section style={{ marginBottom: "2.5rem" }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--gold)", display: "block", marginBottom: ".6rem", fontSize: ".9rem" }}>
            {player.position === "G" ? "Goalie" : player.position ?? "Player"}
          </span>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.4rem,5.5vw,4rem)", lineHeight: 0.98, textTransform: "uppercase", letterSpacing: ".01em", margin: "0 0 .6rem" }}>
            {player.full_name}
          </h1>
          {player.birth_date ? (
            <p style={{ color: "var(--text-secondary)", fontSize: ".95rem" }}>
              Born {formatGameDate(player.birth_date, true)}
              {player.birth_country ? `, ${player.birth_country}` : ""}
              {player.shoots_catches ? ` · Shoots/catches ${player.shoots_catches}` : ""}
            </p>
          ) : (
            <p style={{ color: "var(--text-secondary)", fontSize: ".9rem" }}>
              No bio on file — this player joined a team after that season&apos;s roster was last fetched.
            </p>
          )}
        </section>

        <section style={{ marginBottom: "2.5rem" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".02em", fontSize: "1.4rem", marginBottom: ".2rem" }}>
            {fullCareer ? "Career Totals" : "Totals Since 2007-08"}
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
                <StatTile label="SV%" value={totals.save_pct ?? "—"} />
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
        </section>

        {seasonSplits.length > 0 && (
          <section style={{ marginBottom: "2.5rem" }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".02em", fontSize: "1.4rem", marginBottom: "1rem" }}>
              Season by Season
            </h2>
            <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", overflowX: "auto" }}>
              <table className="box-score-table" style={{ minWidth: isGoalie ? 480 : 560, padding: "0 18px" }}>
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
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {seasonSplits.map((s) => (
                    <tr key={`${s.season_id}-${s.team_abbrev}`}>
                      <td style={{ textAlign: "left" }}>{formatSeasonLabel(s.season_id)}</td>
                      <td style={{ textAlign: "left" }}>{s.team_abbrev}</td>
                      <td>{s.games}</td>
                      {isGoalie ? (
                        <>
                          <td>{s.wins}</td>
                          <td>{s.losses}</td>
                          <td>{s.otl}</td>
                          <td>{s.shutouts}</td>
                          <td style={{ fontWeight: 700, color: "var(--gold)" }}>{s.savePct != null ? s.savePct.toFixed(3) : "—"}</td>
                        </>
                      ) : (
                        <>
                          <td>{s.goals}</td>
                          <td>{s.assists}</td>
                          <td style={{ fontWeight: 700, color: "var(--gold)" }}>{s.points}</td>
                          <td>{s.plus_minus > 0 ? `+${s.plus_minus}` : s.plus_minus}</td>
                          <td>{s.pim}</td>
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
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem", fontVariantNumeric: "tabular-nums", minWidth: 480 }}>
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
                    <td style={tdStyle("left")}>{g.team_abbrev}</td>
                    <td style={tdStyle("left")}>{g.is_home ? "vs" : "@"} {g.opp_abbrev}</td>
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
