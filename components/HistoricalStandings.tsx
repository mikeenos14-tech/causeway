import Link from "next/link";
import type { HistStandingRow } from "@/lib/history-standings";
import { TeamLogo, hasTeamLogo } from "@/components/TeamLogo";
import { teamNickname } from "@/lib/team-names";

// A past season's final standings, in that era's columns: T until 2004-05,
// OTL from 1999-2000 (both in 1999-2004), GF/GA where recorded. Teams that
// made the playoffs carry a gold dot. Only today's clubs link to a team
// page (a code alone isn't a franchise: the 1920s SEN aren't today's OTT).

export function HistoricalStandings({ seasonId, rows }: { seasonId: string; rows: HistStandingRow[] }) {
  const showT = seasonId < "20052006";
  const showOTL = seasonId >= "19992000";
  const showGoals = rows.some((r) => r.gf != null);
  const cols = ["GP", "W", "L", ...(showT ? ["T"] : []), ...(showOTL ? ["OTL"] : []), "PTS", ...(showGoals ? ["GF", "GA"] : [])];
  // Phones drop GP and GF/GA (columns sized 0 by CSS) and narrow the rest.
  const colWidth = (c: string) => (c === "GF" || c === "GA" ? "var(--hist-goals-col, 38px)" : c === "GP" ? "var(--hist-gp-col, 36px)" : "var(--hist-num-col, 36px)");
  const colClass = (c: string) => (c === "GF" || c === "GA" ? "hist-col-goals" : c === "GP" ? "hist-col-gp" : undefined);
  const template = `26px minmax(0, 1fr) ${cols.map(colWidth).join(" ")}`;

  const groups = new Map<string, HistStandingRow[]>();
  for (const r of rows) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);

  return (
    <>
      <p style={{ fontSize: ".8rem", color: "var(--text-secondary)", margin: "0 0 1.5rem" }}>
        <span style={{ color: "var(--gold)" }}>●</span> made the playoffs
        {showT ? " · T: ties" : ""}
        {showOTL ? " · OTL: overtime and shootout losses" : ""}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))", gap: "1.75rem" }}>
        {[...groups.entries()].map(([group, teams]) => (
          <section key={group}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: ".9rem", gap: 12 }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".02em", fontSize: "1.4rem", margin: 0 }}>{group}</h2>
              {teams[0].groupParent && (
                <span style={{ fontSize: ".78rem", color: "var(--text-secondary)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>{teams[0].groupParent}</span>
              )}
            </div>
            <div className="hist-standings" style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: template, padding: "10px 14px", fontSize: ".68rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", borderBottom: "1px solid var(--border)", textAlign: "right" }}>
                <span style={{ textAlign: "left" }}>#</span>
                <span style={{ textAlign: "left" }}>Team</span>
                {cols.map((c) => (
                  <span key={c} className={colClass(c)}>
                    {c}
                  </span>
                ))}
              </div>
              {teams.map((t, i) => {
                const isBos = t.code === "BOS";
                const linkable = hasTeamLogo(t.code) && t.code !== "ARI";
                const values = [t.gp, t.w, t.l, ...(showT ? [t.t] : []), ...(showOTL ? [t.otl] : []), t.pts, ...(showGoals ? [t.gf ?? "—", t.ga ?? "—"] : [])];
                // The playoff dot sits outside the truncating name, so a long
                // name cut short ("Philadelphia …") never hides it.
                const nameCell = (
                  <span style={{ minWidth: 0, display: "flex", alignItems: "center", textAlign: "left", paddingRight: 6 }}>
                    <TeamLogo abbrev={t.code} size={18} gap={4} />
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <span className="name-full">{t.name}</span>
                      <span className="name-short">{teamNickname(t.code, t.name)}</span>
                    </span>
                    {t.madePlayoffs && <span title="Made the playoffs" aria-label="made the playoffs" style={{ color: "var(--gold)", marginLeft: 5, fontSize: ".7rem", flexShrink: 0 }}>●</span>}
                  </span>
                );
                const rowStyle = {
                  display: "grid",
                  gridTemplateColumns: template,
                  alignItems: "center",
                  padding: "10px 14px",
                  fontSize: ".86rem",
                  textAlign: "right" as const,
                  borderTop: i ? "1px solid var(--border)" : "none",
                  textDecoration: "none",
                  background: isBos ? "rgba(255,184,28,0.08)" : "transparent",
                  borderLeft: isBos ? "3px solid var(--gold)" : "3px solid transparent",
                  color: isBos ? "var(--text-primary)" : "var(--text-secondary)",
                  fontWeight: isBos ? 700 : 400,
                  fontVariantNumeric: "tabular-nums" as const,
                };
                const cells = (
                  <>
                    <span style={{ textAlign: "left", color: isBos ? "var(--gold)" : "inherit" }}>{t.rank < 999 ? t.rank : i + 1}</span>
                    {nameCell}
                    {values.map((v, k) => (
                      <span key={k} className={colClass(cols[k])} style={cols[k] === "PTS" ? { fontWeight: 700, color: isBos ? "var(--gold)" : "inherit" } : undefined}>
                        {v}
                      </span>
                    ))}
                  </>
                );
                return linkable ? (
                  <Link key={t.teamId} href={`/teams/${t.code}`} style={rowStyle}>
                    {cells}
                  </Link>
                ) : (
                  <div key={t.teamId} style={rowStyle}>
                    {cells}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
