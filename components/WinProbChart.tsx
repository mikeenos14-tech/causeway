import type { WpTimeline } from "@/lib/wp-game";
import { TeamLogo } from "@/components/TeamLogo";

// A finished game's win-probability curve (lib/wp-game.ts), drawn from one
// team's side: the Bruins on their games, else the home team. The line is
// SVG stretched to the box; text, goal dots and gridline labels are HTML
// laid over it, so they stay readable at phone width.

const pct = (p: number) => {
  const v = 100 * p;
  if (v > 0 && v < 1) return "<1%";
  if (v < 100 && v > 99) return ">99%";
  return `${Math.round(v)}%`;
};

const clock = (t: number) => {
  if (t >= 3600) {
    const s = t - 3600;
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} of OT`;
  }
  const period = Math.min(3, Math.floor(t / 1200) + 1);
  const s = t - (period - 1) * 1200;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} of the ${["1st", "2nd", "3rd"][period - 1]}`;
};

const lastName = (name: string | null) => (name ? name.split(" ").slice(1).join(" ") || name : "Unknown scorer");

export function WinProbChart({ tl, sideHome, finalNote }: { tl: WpTimeline; sideHome: boolean; finalNote?: string }) {
  const team = sideHome ? tl.homeCode : tl.awayCode;
  const opp = sideHome ? tl.awayCode : tl.homeCode;
  const val = (p: number) => (sideHome ? p : 1 - p);
  const pts = tl.points.map((x) => ({ ...x, v: val(x.p) }));
  const endT = Math.max(3600, tl.endT);
  const X = (t: number) => (100 * t) / endT;
  const Y = (v: number) => 100 * (1 - v);
  const line = pts.map((x, i) => `${i ? "L" : "M"}${X(x.t).toFixed(3)},${Y(x.v).toFixed(3)}`).join("");
  const area = `${line}L${X(pts.at(-1)!.t).toFixed(3)},50L0,50Z`;

  const goals = pts.filter((x) => x.goal);
  const swing = tl.biggestSwing;
  const ours = (home: boolean) => home === sideHome;
  const fin = pts.at(-1)!.v;
  const won = fin === 1, lost = fin === 0;
  // The far end of the curve: a winner's low point, a loser's high point.
  const extreme = pts.slice(0, -1).reduce((best, x) => (won ? (x.v < best.v ? x : best) : x.v > best.v ? x : best), pts[0]);
  const ties = tl.tiesPossible;
  const m = tl.metrics;

  const periods = [
    { t: 1200, label: "1st" },
    { t: 2400, label: "2nd" },
    { t: 3600, label: "3rd" },
    ...(endT > 3600 ? [{ t: endT, label: "OT" }] : []),
  ];

  return (
    <section style={{ marginBottom: "2.5rem" }} aria-labelledby="wp-heading">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: ".75rem" }}>
        <h2 id="wp-heading" style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.35rem", textTransform: "uppercase", letterSpacing: ".04em", margin: 0 }}>
          Win probability
        </h2>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: ".82rem", color: "var(--text-secondary)" }}>
          <TeamLogo abbrev={team} size={18} gap={0} />
          {team} chance to win{ties ? " (a tie counts half)" : ""}
        </span>
      </div>

      <div className="wp-stats">
        <div>
          <span className="wp-stat-label">Puck drop</span>
          <span className="wp-stat-value">{pct(val(tl.pregame))}</span>
        </div>
        {(won || lost) && (
          <div>
            <span className="wp-stat-label">{won ? "Low point" : "High point"}</span>
            <span className="wp-stat-value">{pct(extreme.v)}</span>
            <span className="wp-stat-note">{extreme.t === 0 ? "at puck drop" : clock(extreme.t)}</span>
          </div>
        )}
        {swing && (
          <div>
            <span className="wp-stat-label">Biggest swing</span>
            <span className="wp-stat-value">
              {pct(val(swing.from))} → {pct(val(swing.to))}
            </span>
            <span className="wp-stat-note">
              {lastName(swing.scorer)} ({ours(swing.home) ? team : opp}), {clock(swing.t)}
            </span>
          </div>
        )}
      </div>

      <div className="wp-chart" role="img" aria-label={`${team} win probability through the game: ${pct(val(tl.pregame))} at puck drop, ${won ? "won" : lost ? "lost" : "tied"}.`}>
        <div className="wp-plot">
          {[0.25, 0.5, 0.75].map((v) => (
            <div key={v} className={v === 0.5 ? "wp-grid wp-grid-mid" : "wp-grid"} style={{ top: `${Y(v)}%` }} />
          ))}
          {periods.slice(0, -1).map((p) => (
            <div key={p.t} className="wp-period" style={{ left: `${X(p.t)}%` }} />
          ))}
          <div className="wp-draw">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <path d={area} className="wp-area" />
              <path d={line} className="wp-line" vectorEffect="non-scaling-stroke" />
            </svg>
            {goals.map((x, i) => (
              <span
                key={i}
                className={ours(x.goal!.home) ? "wp-goal wp-goal-ours" : "wp-goal"}
                style={{ left: `${X(x.t)}%`, top: `${Y(x.v)}%` }}
                title={`${lastName(x.goal!.scorer)} (${ours(x.goal!.home) ? team : opp}), ${clock(x.t)}: ${pct(x.v)}`}
              />
            ))}
          </div>
          <span className="wp-ylabel" style={{ top: "0%" }}>100%</span>
          <span className="wp-ylabel" style={{ top: "50%" }}>50%</span>
          <span className="wp-ylabel" style={{ top: "100%" }}>0%</span>
        </div>
        <div className="wp-xaxis">
          {periods.map((p, i) => (
            <span key={p.t} style={{ left: `${(X(p.t) + (i ? X(periods[i - 1].t) : 0)) / 2}%` }}>
              {p.label}
            </span>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: ".78rem", color: "var(--text-secondary)", marginTop: ".5rem" }}>
        <span><span className="wp-goal wp-goal-ours wp-goal-key" /> {team} goal</span>
        <span><span className="wp-goal wp-goal-key" /> {opp} goal</span>
        {finalNote && <span>{finalNote}</span>}
      </div>

      <details className="wp-how">
        <summary>How this works</summary>
        <p>
          At every moment, the chance comes from the score, the time left, and how strong each team was going in (their Elo ratings). Each team&rsquo;s remaining goals are
          projected from how often teams scored in that era, then corrected by what actually happened from the same spot in every NHL game since 1917
          {ties ? "; a tie counts as half a win, since ties were possible then" : ""}.
        </p>
        <p>
          Tested on {m.heldOutGames.toLocaleString()} games the model never trained on (every fifth season), its chances landed within {m.calibrationErrorPts.toFixed(1)} percentage
          points of how often those teams actually won. Knowing team strength beats the score and clock alone; the score and clock beat the pregame odds alone by a wide margin.
          Goalie pulls, power plays and injuries aren&rsquo;t modeled directly; they show up only through what history says about each score and minute.
        </p>
      </details>
    </section>
  );
}
