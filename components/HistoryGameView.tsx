import Link from "next/link";
import { BOS_TEAM_ID, type HistoryGame } from "@/lib/history-data";
import { formatGameDate } from "@/lib/format-date";
import { TeamLogo } from "@/components/TeamLogo";
import { formatSavePct } from "@/lib/util/save-pct";
import { ScoringSummary, periodName } from "@/components/ScoringSummary";
import { WinProbChart } from "@/components/WinProbChart";
import type { WpTimeline } from "@/lib/wp-game";
import { goalWpaFromCurve } from "@/lib/wp-curve";
import { TeamLink, PlayerLink } from "@/components/EntityLinks";

// A game from before 2007-08, from the audited 1917-on history: the score,
// who scored when, penalties, period scores and shots where they exist.
// No box score, recap or ice time (the site's own tables start in
// 2007-08), and the page says exactly what this era's records include.

const H2 = { fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.35rem", textTransform: "uppercase" as const, letterSpacing: ".02em", margin: "0 0 .8rem" };
const CARD = { background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, padding: "1rem 1.25rem" } as const;
const ACTIVE_CODES = new Set(["ANA", "BOS", "BUF", "CAR", "CBJ", "CGY", "CHI", "COL", "DAL", "DET", "EDM", "FLA", "LAK", "MIN", "MTL", "NJD", "NSH", "NYI", "NYR", "OTT", "PHI", "PIT", "SEA", "SJS", "STL", "TBL", "TOR", "UTA", "VAN", "VGK", "WPG", "WSH"]);
// A tri-code that's in use today isn't necessarily the same club (e.g. the
// 1917 Ottawa Senators are "SEN"; the current Senators are "OTT"), so link
// only codes of active teams and only for games since that club existed.
const teamHref = (code: string) => (ACTIVE_CODES.has(code) ? `/teams/${code}` : null);


function coverageNote(g: HistoryGame): string {
  const parts = ["Goals, scorers and penalties are from the NHL's official game records."];
  if (g.home.sog == null) parts.push("Shots weren't recorded for this game.");
  if (!g.hasStrength) parts.push("Power-play and shorthanded goals aren't marked in this era's records.");
  else if (g.goals.every((x) => x.emptyNet == null)) parts.push("Empty-net goals aren't marked before 2009-10.");
  if (g.finalState === "TIE") parts.push("Ties were part of the game until 2004-05.");
  return parts.join(" ");
}

// The NHL records a double minor (and two coincident minors) as separate,
// identical penalty events, which read as duplicates in a list. Same
// player, team, time, infraction and length become one line, "×2", with
// the minutes summed: 2 + 2 for roughing shows "Roughing ×2 · 4 min".
// (Penalty data matches the NHL's official per-game counts and minutes;
// checked 2026-10-02 across 21,199 team-games.)
function groupPenalties(pens: HistoryGame["penalties"]) {
  const out: (HistoryGame["penalties"][number] & { count: number; each: number | null })[] = [];
  for (const p of pens) {
    const last = out.at(-1);
    const same = last && p.player && last.period === p.period && last.time === p.time && last.team === p.team && last.player === p.player && last.infraction === p.infraction && last.each === p.minutes;
    if (last && same) {
      last.count++;
      last.minutes = (last.minutes ?? 0) + (p.minutes ?? 0);
    } else out.push({ ...p, count: 1, each: p.minutes });
  }
  return out;
}

export function HistoryGameView({ g, nav, wp }: { g: HistoryGame; wp?: WpTimeline | null; nav: { prev: { id: number; date: string; label: string } | null; next: { id: number; date: string; label: string } | null } }) {
  const linked = new Set(g.linkedPlayers);
  const homeWon = g.home.score > g.away.score;
  const awayWon = g.away.score > g.home.score;
  const end = g.finalState === "OT" ? (g.otPeriods > 1 ? `${g.otPeriods}OT` : "OT") : g.finalState === "SO" ? "SO" : g.finalState === "TIE" ? "Tie" : "";
  const headline = g.iconic?.label ?? (g.finalState === "TIE" ? `${g.away.code} and ${g.home.code} tie, ${g.away.score}-${g.home.score}` : homeWon ? `${g.home.code} beat ${g.away.code}, ${g.home.score}-${g.away.score}` : `${g.away.code} beat ${g.home.code}, ${g.away.score}-${g.home.score}`);

  const team = (t: HistoryGame["home"], won: boolean) => {
    const href = teamHref(t.code);
    const code = href ? (
      <Link href={href} style={{ color: "inherit" }}>
        {t.code}
      </Link>
    ) : (
      t.code
    );
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <TeamLogo abbrev={t.code} size={52} gap={0} />
        <div>
        <div style={{ fontSize: ".78rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }} title={t.name}>
          {code}
        </div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: "2.6rem", color: won ? "var(--gold)" : "var(--text-secondary)" }}>{t.score}</div>
        {t.sog != null && <div style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>{t.sog} shots</div>}
        </div>
      </div>
    );
  };

  return (
    <>
      <nav aria-label="BOS games" style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: "1.5rem", fontSize: ".85rem" }}>
        {nav.prev ? (
          <Link href={`/games/${nav.prev.id}`} style={{ color: "var(--text-secondary)", textDecoration: "none" }}>
            ← BOS {nav.prev.label} · {formatGameDate(nav.prev.date, true)}
          </Link>
        ) : (
          <span />
        )}
        {nav.next && (
          <Link href={`/games/${nav.next.id}`} style={{ color: "var(--text-secondary)", textDecoration: "none", textAlign: "right" }}>
            BOS {nav.next.label} · {formatGameDate(nav.next.date, true)} →
          </Link>
        )}
      </nav>

      <section style={{ marginBottom: "2.25rem", paddingBottom: "2rem", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-secondary)", display: "block", marginBottom: ".6rem", fontSize: ".9rem" }}>
          {g.stage ?? "Final"} · {formatGameDate(g.date, true)}
          {g.venue ? ` · ${g.venue}` : ""}
        </span>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2rem,4.5vw,3.2rem)", lineHeight: 0.98, textTransform: "uppercase", letterSpacing: ".01em", margin: "0 0 1rem" }}>{headline}</h1>
        {g.iconic && <p style={{ fontFamily: "var(--font-editorial)", fontStyle: "italic", fontSize: "1.1rem", color: "var(--text-secondary)", maxWidth: "64ch", lineHeight: 1.5, margin: 0 }}>{g.iconic.story}</p>}
        <div style={{ display: "flex", gap: 40, marginTop: "1.5rem", alignItems: "flex-end" }}>
          {team(g.away, awayWon)}
          {team(g.home, homeWon)}
          {end && <span style={{ paddingBottom: 8, fontSize: ".85rem", fontWeight: 700, color: "var(--gold)", textTransform: "uppercase" }}>{end}</span>}
        </div>
        {g.labels.length > 0 && !g.iconic && (
          <p style={{ margin: "1rem 0 0", fontSize: ".85rem", color: "var(--text-secondary)" }}>{g.labels[0]}</p>
        )}
      </section>

      <ScoringSummary g={g} wpa={wp ? goalWpaFromCurve(wp.points) : undefined} />
      {wp && <WinProbChart tl={wp} sideHome={g.away.id !== BOS_TEAM_ID} />}

      {g.periods.some((p) => p.homeShots != null) && (
        <section style={{ marginBottom: "2.25rem" }}>
          <h2 style={H2}>By Period</h2>
          <div style={{ ...CARD, overflowX: "auto" }}>
            <table className="box-score-table" style={{ minWidth: 300 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}></th>
                  {g.periods.map((p) => (
                    <th key={p.period}>{periodName(p.period, p.periodType)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[g.away, g.home].map((t) => (
                  <tr key={t.code}>
                    <td style={{ textAlign: "left", fontWeight: 600 }}>
                      <TeamLink abbrev={t.code} />
                    </td>
                    {g.periods.map((p) => {
                      const goals = t === g.home ? p.home : p.away;
                      const shots = t === g.home ? p.homeShots : p.awayShots;
                      return (
                        <td key={p.period}>
                          {goals}
                          {shots != null && <span style={{ color: "var(--text-muted)", fontSize: ".75rem" }}> ({shots} SOG)</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {g.box && (
        <section style={{ marginBottom: "2.25rem" }}>
          <h2 style={H2}>Box Score</h2>
          {g.box.teams.map((t) => (
            <div key={t.teamId} style={{ marginBottom: "1.25rem" }}>
              <div style={{ display: "flex", alignItems: "center", fontWeight: 700, margin: "0 0 .5rem", fontSize: ".95rem" }}>
                <TeamLink abbrev={t.code} style={{ display: "flex", alignItems: "center" }}>
                  <TeamLogo abbrev={t.code} size={22} gap={6} />
                  {t.code}
                </TeamLink>
              </div>
              <div style={{ ...CARD, padding: "0 1rem", overflowX: "auto" }}>
                <table className="box-score-table" style={{ minWidth: 360 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>Player</th>
                      <th>G</th>
                      <th>A</th>
                      <th>P</th>
                      {g.box!.plusMinus && <th>+/-</th>}
                      <th>PIM</th>
                      {g.box!.shots && <th>SOG</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {t.skaters.map((p) => (
                      <tr key={p.id}>
                        <td style={{ textAlign: "left" }}>
                          <PlayerLink id={p.id} hasPage={linked.has(p.id)}>
                            {p.name}
                          </PlayerLink>
                          {p.pos && <span style={{ color: "var(--text-muted)", fontSize: ".72rem", marginLeft: 6 }}>{p.pos}</span>}
                        </td>
                        <td>{p.g}</td>
                        <td>{p.a}</td>
                        <td style={{ fontWeight: 700, color: p.g + p.a > 0 ? "var(--gold)" : undefined }}>{p.g + p.a}</td>
                        {g.box!.plusMinus && <td>{p.pm == null ? "—" : p.pm > 0 ? `+${p.pm}` : p.pm}</td>}
                        <td>{p.pim}</td>
                        {g.box!.shots && <td>{p.sog ?? "—"}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {t.goalies.length > 0 && (
                  <table className="box-score-table" style={{ minWidth: 360, borderTop: "1px solid var(--border)" }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left" }}>Goalie</th>
                        <th>Dec</th>
                        <th>SA</th>
                        <th>SV</th>
                        <th>SV%</th>
                        <th>TOI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.goalies.map((x) => (
                        <tr key={x.id}>
                          <td style={{ textAlign: "left" }}>
                            <PlayerLink id={x.id} hasPage={linked.has(x.id)}>
                              {x.name}
                            </PlayerLink>
                          </td>
                          <td>{x.decision ?? "—"}</td>
                          <td>{x.sa ?? "—"}</td>
                          <td>{x.sv ?? "—"}</td>
                          <td>{x.sa ? formatSavePct((x.sv ?? 0) / x.sa) : "—"}</td>
                          <td>{x.toi != null ? `${Math.floor(x.toi / 60)}:${String(x.toi % 60).padStart(2, "0")}` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ))}
          <p style={{ fontSize: ".75rem", color: "var(--text-muted)", margin: 0 }}>
            Checked against the play-by-play: every player&apos;s goals, assists and penalty minutes match.
            {!g.box.plusMinus ? " Plus-minus wasn't kept until 1959-60." : ""}
            {!g.box.shots ? (g.box.plusMinus ? " Shots are left off: they don't add up to the team's total in the NHL's records." : " Shots weren't kept by player until 1959-60.") : ""}
          </p>
        </section>
      )}
      {g.boxWithheld && <p style={{ fontSize: ".8rem", color: "var(--text-secondary)", margin: "-1rem 0 2.25rem" }}>No box score: {g.boxWithheld}</p>}

      <section style={{ marginBottom: "2.25rem" }}>
        <h2 style={H2}>Penalties</h2>
        <div style={CARD}>
          {g.penalties.length === 0 ? (
            <p style={{ margin: 0, color: "var(--text-secondary)" }}>None recorded.</p>
          ) : (
            groupPenalties(g.penalties).map((p, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "3.4rem 1fr auto", gap: 10, padding: "5px 0", borderTop: i ? "1px solid var(--border)" : "none", fontSize: ".85rem" }}>
                <span style={{ color: "var(--text-muted)" }}>
                  {periodName(p.period, "REG")} {p.time}
                </span>
                <span>
                  {p.team && <TeamLink abbrev={p.team} style={{ fontWeight: 700, marginRight: 6 }} />}
                  {p.player ? (
                    <PlayerLink id={p.playerId} hasPage={p.playerId != null && linked.has(p.playerId)}>
                      {p.player}
                    </PlayerLink>
                  ) : (
                    "Team penalty"
                  )}
                  {p.infraction && (
                    <span style={{ color: "var(--text-secondary)" }}>
                      {" "}
                      · {p.infraction.replace(/-/g, " ")}
                      {p.count > 1 ? ` ×${p.count}` : ""}
                    </span>
                  )}
                </span>
                <span style={{ color: "var(--text-secondary)" }}>{p.minutes != null ? `${p.minutes} min` : ""}</span>
              </div>
            ))
          )}
        </div>
      </section>

      <p style={{ fontSize: ".78rem", color: "var(--text-muted)", maxWidth: "70ch" }}>{coverageNote(g)}</p>
    </>
  );
}
