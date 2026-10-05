import type { CSSProperties } from "react";

// The chances card: expected goals for each team (goalies in net), shot
// attempts, by period, and once the game is final, "deserved to win". The
// featured team (the Bruins, else the home side) on the left in gold, as
// in the win-chance bar. lib/xg.ts has the model and what it leaves out.

export type ChancesData = {
  home: number;
  away: number;
  byPeriod: { period: number; home: number; away: number }[];
  shots: { home: number; away: number };
  deservedHome: number;
};

const label: CSSProperties = { fontSize: ".75rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em" };
const periodName = (p: number) => (p <= 3 ? ["1st", "2nd", "3rd"][p - 1] : p === 4 ? "OT" : `${p - 3}OT`);
const one = (x: number) => x.toFixed(1);

function Bar({ share, ariaLabel }: { share: number; ariaLabel: string }) {
  return (
    <div role="img" aria-label={ariaLabel} style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "var(--border)" }}>
      <span style={{ width: `${(100 * share).toFixed(1)}%`, background: "var(--gold)", transition: "width .8s ease" }} />
    </div>
  );
}

export function ChancesCard({ c, homeAbbrev, awayAbbrev, sideHome, final, live = false }: { c: ChancesData; homeAbbrev: string; awayAbbrev: string; sideHome: boolean; final: boolean; live?: boolean }) {
  const [left, right] = sideHome ? [homeAbbrev, awayAbbrev] : [awayAbbrev, homeAbbrev];
  const lx = sideHome ? c.home : c.away, rx = sideHome ? c.away : c.home;
  const ls = sideHome ? c.shots.home : c.shots.away, rs = sideHome ? c.shots.away : c.shots.home;
  const total = lx + rx;
  const share = total > 0 ? lx / total : 0.5;
  const deserved = sideHome ? c.deservedHome : 1 - c.deservedHome;
  const pct = (x: number) => `${Math.round(100 * x)}%`;
  return (
    <section aria-label="Chances" style={{ marginBottom: "2.5rem", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.25rem 1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: ".8rem", flexWrap: "wrap" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".02em", fontSize: "1.5rem", margin: 0 }}>Chances</h2>
        <span style={label}>Expected goals{live ? " · live" : ""}</span>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontFamily: "var(--font-display)", fontSize: "1.9rem", color: "var(--gold)" }}>
          {left} {one(lx)}
        </span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: "1.9rem", color: "var(--text-secondary)" }}>
          {one(rx)} {right}
        </span>
      </div>
      <Bar share={share} ariaLabel={`Expected goals: ${left} ${one(lx)}, ${right} ${one(rx)}`} />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".8rem", color: "var(--text-secondary)", marginTop: 6 }}>
        <span>{ls} shot attempts</span>
        <span>{rs} shot attempts</span>
      </div>

      {c.byPeriod.length > 1 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", fontSize: ".85rem", marginTop: ".9rem" }}>
          {c.byPeriod.map((p) => (
            <span key={p.period}>
              <span style={label}>{periodName(p.period)}</span>{" "}
              <span style={{ color: "var(--gold)" }}>{one(sideHome ? p.home : p.away)}</span>
              <span style={{ color: "var(--text-secondary)" }}> – {one(sideHome ? p.away : p.home)}</span>
            </span>
          ))}
        </div>
      )}

      {final && (
        <div style={{ marginTop: "1.2rem", paddingTop: "1.1rem", borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={label}>
              <span style={{ color: "var(--gold)" }}>{left} {pct(deserved)}</span> deserved to win
            </span>
            <span style={label}>
              {right} {pct(1 - deserved)}
            </span>
          </div>
          <Bar share={deserved} ariaLabel={`Deserved to win: ${left} ${pct(deserved)}, ${right} ${pct(1 - deserved)}`} />
          <p style={{ fontSize: ".85rem", color: "var(--text-secondary)", margin: ".7rem 0 0", lineHeight: 1.5 }}>
            Replay this game&apos;s chances, each scoring at its own odds, and {left} wins {Math.round(100 * deserved)} times in 100.
          </p>
        </div>
      )}

      <p style={{ fontSize: ".75rem", color: "var(--text-secondary)", margin: ".9rem 0 0", lineHeight: 1.5 }}>
        Expected goals: how often shots like these score, from where they were taken, the shot type, rebounds, the rush and the manpower, with a goalie in net.
      </p>
    </section>
  );
}
