import Link from "next/link";
import type { BigGoal, LeaderRow } from "@/lib/leverage-data";
import { formatWpa } from "@/lib/wp-curve";
import { TeamLink } from "@/components/EntityLinks";
import { goalContext } from "@/components/ClutchCard";

// Tables for the Leverage Goals pages (app/history/leverage).

export const H2 = { fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.45rem", textTransform: "uppercase" as const, letterSpacing: ".02em", margin: "0 0 .35rem" };
export const SUB = { color: "var(--text-secondary)", fontSize: ".86rem", margin: "0 0 .9rem", maxWidth: "70ch", lineHeight: 1.5 };
const CARD = { background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" as const };
const TH = { textAlign: "left" as const, padding: "9px 12px", fontSize: ".7rem", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase" as const, letterSpacing: ".05em", whiteSpace: "nowrap" as const };
const TD = { padding: "9px 12px", borderTop: "1px solid var(--border)", verticalAlign: "top" as const };

const PlayerName = ({ id, name, linked }: { id: number | null; name: string | null; linked: Set<number> }) =>
  id && linked.has(id) ? (
    <Link href={`/players/${id}`} style={{ color: "var(--text-primary)", textDecoration: "none", fontWeight: 600 }}>
      {name}
    </Link>
  ) : (
    <span style={{ fontWeight: 600 }}>{name ?? "Unknown scorer"}</span>
  );

// measure: what the big number is. "wpa" the goal's win chance added;
// "series" that times its game's series stakes; "cup" that times how much
// winning the series moved the Cup chance.
export function GoalTable({ goals, linked, measure = "wpa" }: { goals: BigGoal[]; linked: Set<number>; measure?: "wpa" | "series" | "cup" }) {
  const value = (g: BigGoal) => (measure === "cup" ? g.wpa * (g.stakes ?? 0) * (g.cupFactor ?? 0) : measure === "series" ? g.wpa * (g.stakes ?? 0) : g.wpa);
  return (
    <div style={CARD}>
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {goals.map((g, i) => (
          <li key={`${g.gameId}-${i}`} className="lev-goal-row" style={{ borderTop: i ? "1px solid var(--border)" : "none" }}>
            <span className="lev-rank">{i + 1}</span>
            <span style={{ minWidth: 0 }}>
              <PlayerName id={g.scorerId} name={g.scorer} linked={linked} />
              <span style={{ color: "var(--text-secondary)" }}>
                {" "}
                ·{" "}
                <Link href={`/games/${g.gameId}`} style={{ color: "var(--text-secondary)" }}>
                  {g.scoreAfter}
                </Link>
              </span>
              <span style={{ display: "block", fontSize: ".78rem", color: "var(--text-secondary)" }}>{goalContext(g)}</span>
            </span>
            <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              <span style={{ fontWeight: 700, color: "var(--gold)" }}>{formatWpa(value(g))}</span>
              <span style={{ display: "block", fontSize: ".75rem", color: "var(--text-secondary)" }}>
                {measure === "wpa" ? `${Math.round(100 * g.before)}% → ${Math.round(100 * g.after)}%` : `game ${formatWpa(g.wpa)}`}
                {measure !== "wpa" && g.stakes != null && g.stakes < 0.995 ? ` · stakes ${g.stakes.toFixed(2)}` : ""}
                {measure === "cup" && g.cupFactor != null && g.cupFactor < 0.995 ? ` · Cup ${g.cupFactor.toFixed(2)}` : ""}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function LeaderTable({ rows, linked, playoff = false, showTeam = true, sortedByDecided = false }: { rows: LeaderRow[]; linked: Set<number>; playoff?: boolean; showTeam?: boolean; sortedByDecided?: boolean }) {
  const decidedClass = sortedByDecided ? undefined : "lev-col-optional";
  return (
    <div style={{ ...CARD, overflowX: "auto" }}>
      <table className="lev-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: ".86rem", fontVariantNumeric: "tabular-nums" }}>
        <thead>
          <tr>
            <th style={{ ...TH, width: 36 }}>#</th>
            <th style={TH}>Player</th>
            {showTeam && <th style={TH} className="lev-col-optional">Team</th>}
            <th style={{ ...TH, textAlign: "right" }}>Goals</th>
            <th style={{ ...TH, textAlign: "right" }} className={playoff ? "lev-col-optional" : undefined} title="Win probability added by his goals, in wins">Wins added</th>
            {playoff && <th style={{ ...TH, textAlign: "right" }} title="Wins added, each goal weighted by its game's series stakes">Series added</th>}
            {playoff && <th style={{ ...TH, textAlign: "right" }} title="Series added, each goal also weighted by how much its series mattered to the Stanley Cup (1926-27 on)">Cups added</th>}
            <th style={{ ...TH, textAlign: "right" }} className={playoff ? "lev-col-optional" : undefined} title="Average win chance added per goal">Per goal</th>
            <th style={{ ...TH, textAlign: "right" }} className={decidedClass} title="Goals that moved the win chance under 2 points">Decided</th>
            <th style={{ ...TH, textAlign: "right" }} className="lev-col-optional" title="Win chance added by his assists: half the goal's value as the first assist, a quarter as the second">Assists</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.playerId}>
              <td style={{ ...TD, color: "var(--text-muted)" }}>{i + 1}</td>
              <td style={TD}>
                <PlayerName id={r.playerId} name={r.name} linked={linked} />
              </td>
              {showTeam && <td style={{ ...TD, color: "var(--text-secondary)" }} className="lev-col-optional">{r.team ? <TeamLink abbrev={r.team} /> : "—"}</td>}
              <td style={{ ...TD, textAlign: "right" }}>{r.goals}</td>
              <td style={{ ...TD, textAlign: "right", fontWeight: 700, color: playoff ? undefined : "var(--gold)" }} className={playoff ? "lev-col-optional" : undefined}>{r.lg.toFixed(1)}</td>
              {playoff && <td style={{ ...TD, textAlign: "right", fontWeight: 700, color: "var(--gold)" }}>{(r.playoffLg ?? 0).toFixed(2)}</td>}
              {playoff && <td style={{ ...TD, textAlign: "right" }}>{(r.cupLg ?? 0).toFixed(2)}</td>}
              <td style={{ ...TD, textAlign: "right" }} className={playoff ? "lev-col-optional" : undefined}>{formatWpa(r.perGoal)}</td>
              <td style={{ ...TD, textAlign: "right" }} className={decidedClass}>{Math.round(100 * r.garbagePct)}%</td>
              <td style={{ ...TD, textAlign: "right", color: "var(--text-secondary)" }} className="lev-col-optional">{r.assistLg.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LeverageNav({ active }: { active: "bruins" | "league" }) {
  const chip = (on: boolean) => ({
    padding: "7px 14px",
    borderRadius: 999,
    border: "1px solid var(--border)",
    fontSize: ".85rem",
    fontWeight: 600,
    textDecoration: "none",
    color: on ? "var(--ink)" : "var(--text-primary)",
    background: on ? "var(--gold)" : "transparent",
  });
  return (
    <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 2rem" }} aria-label="Leverage views">
      <Link href="/history/leverage" style={chip(active === "bruins")} aria-current={active === "bruins" ? "page" : undefined}>
        Bruins
      </Link>
      <Link href="/history/leverage/league" style={chip(active === "league")} aria-current={active === "league" ? "page" : undefined}>
        League leaders
      </Link>
    </nav>
  );
}

export function LeverageIntro() {
  return (
    <p style={{ color: "var(--text-secondary)", fontSize: ".95rem", maxWidth: "70ch", lineHeight: 1.55, margin: "0 0 1.25rem" }}>
      Every goal is worth what it did to its team&rsquo;s chance of winning, from just before it to just after, using the site&rsquo;s win probability
      model. A tying goal in the final minute can be worth 40 points or more; the fifth goal of a 6-1 game, almost nothing. Added up over a career, a
      player&rsquo;s goals come to a number of wins. In the playoffs, each goal is also weighted by how much its game mattered to the series: a Game 7
      counts fully, a game in a series nearly decided, very little.
    </p>
  );
}
