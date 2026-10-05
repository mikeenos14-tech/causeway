import Link from "next/link";
import type { CSSProperties } from "react";
import { heatLabel, type GrudgePair, type GrudgeSide } from "@/lib/grudge-data";

// Grudge Index pieces: the heat bar, the two-way gauge (each side's grudge
// toward the other, with the top reason), and the rivalry timeline.

export const heatColor = (index: number) =>
  index >= 90 ? "#e4572e" : index >= 75 ? "#f08a24" : index >= 60 ? "var(--gold)" : index >= 40 ? "#b9a06a" : "#7c8794";

const small: CSSProperties = { fontSize: ".75rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em" };

export const rivalryHref = (a: string, b: string) => `/rivalries/${a}-${b}`;

function HeatRow({ from, to, s, showReason = true }: { from: string; to: string; s: GrudgeSide; showReason?: boolean }) {
  return (
    <div style={{ marginBottom: ".9rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 5 }}>
        <span style={{ fontWeight: 600 }}>
          {from} <span style={{ color: "var(--text-secondary)" }}>toward</span> {to}
        </span>
        <span style={{ whiteSpace: "nowrap" }}>
          <span style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem", color: heatColor(s.index) }}>{Math.round(s.index)}</span>{" "}
          <span style={{ ...small, color: heatColor(s.index) }}>{heatLabel(s.index)}</span>
        </span>
      </div>
      <div role="img" aria-label={`${from}'s grudge toward ${to}: ${Math.round(s.index)} of 100, ${heatLabel(s.index)}`} style={{ height: 8, borderRadius: 4, background: "var(--border)", overflow: "hidden" }}>
        <span style={{ display: "block", height: "100%", width: `${s.index.toFixed(1)}%`, background: heatColor(s.index) }} />
      </div>
      {showReason && s.top[0] && <div style={{ fontSize: ".82rem", color: "var(--text-secondary)", marginTop: 5 }}>{s.top[0].text}</div>}
    </div>
  );
}

// Both directions; `compact` for previews (one reason each, a link out).
export function TwoWayGauge({ p, compact = false, title = "Grudge Index" }: { p: GrudgePair; compact?: boolean; title?: string }) {
  return (
    <section aria-label="Grudge Index" style={{ marginBottom: "2rem", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.2rem 1.4rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: ".9rem", flexWrap: "wrap" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".02em", fontSize: compact ? "1.25rem" : "1.5rem", margin: 0 }}>{title}</h2>
        <span style={small}>Rivalry heat, 0-100</span>
      </div>
      <HeatRow from={p.a.abbrev} to={p.b.abbrev} s={p.ab} />
      <HeatRow from={p.b.abbrev} to={p.a.abbrev} s={p.ba} />
      {compact && (
        <Link href={rivalryHref(p.a.abbrev, p.b.abbrev)} style={{ fontSize: ".85rem", fontWeight: 600, color: "var(--gold)", textDecoration: "none" }}>
          The whole rivalry →
        </Link>
      )}
    </section>
  );
}

// Monthly index both ways since the first meeting: `a` in gold, `b` grey.
// The lines stretch with the box; the labels are HTML so they don't.
export function GrudgeTimeline({ points, a, b }: { points: { month: string; ab: number; ba: number }[]; a: string; b: string }) {
  if (points.length < 2) return null;
  const W = 1000, H = 260;
  const t0 = Date.parse(points[0].month), t1 = Date.parse(points.at(-1)!.month);
  const x = (m: string) => ((Date.parse(m) - t0) / (t1 - t0)) * W;
  const y = (v: number) => H - (v / 100) * H;
  const path = (k: "ab" | "ba") => points.map((p, i) => `${i ? "L" : "M"}${x(p.month).toFixed(1)},${y(p[k]).toFixed(1)}`).join("");
  const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear();
  const step = y1 - y0 > 60 ? 20 : y1 - y0 > 25 ? 10 : 5;
  const ticks: number[] = [];
  for (let yr = Math.ceil(y0 / step) * step; yr <= y1; yr += step) ticks.push(yr);
  const peak = points.reduce((m, p) => (Math.max(p.ab, p.ba) > Math.max(m.ab, m.ba) ? p : m), points[0]);
  const pct = (m: string) => `${((Date.parse(m) - t0) / (t1 - t0)) * 100}%`;
  const clamp = (m: string) => `${Math.min(92, Math.max(8, ((Date.parse(m) - t0) / (t1 - t0)) * 100))}%`; // keep the label inside the box
  return (
    <figure style={{ margin: "0 0 2.5rem" }}>
      <div style={{ display: "flex", gap: 18, fontSize: ".82rem", marginBottom: 8, flexWrap: "wrap" }}>
        <span><span style={{ display: "inline-block", width: 14, height: 3, background: "var(--gold)", verticalAlign: "middle", marginRight: 6 }} />{a} toward {b}</span>
        <span><span style={{ display: "inline-block", width: 14, height: 3, background: "var(--text-secondary)", verticalAlign: "middle", marginRight: 6 }} />{b} toward {a}</span>
      </div>
      <div style={{ position: "relative", height: 220 }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height="100%" role="img" aria-label={`Rivalry heat over time, ${a} and ${b}; hottest in ${peak.month.slice(0, 4)}`}>
          {[25, 50, 75].map((v) => <line key={v} x1={0} x2={W} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
          <path d={path("ba")} fill="none" stroke="var(--text-secondary)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          <path d={path("ab")} fill="none" stroke="var(--gold)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
        {[25, 50, 75].map((v) => (
          <span key={v} aria-hidden="true" style={{ position: "absolute", left: 0, top: `${100 - v}%`, transform: "translateY(-115%)", fontSize: ".68rem", color: "var(--text-secondary)" }}>{v}</span>
        ))}
        <span style={{ position: "absolute", left: clamp(peak.month), top: `${100 - Math.max(peak.ab, peak.ba)}%`, transform: "translate(-50%, -130%)", fontSize: ".72rem", fontWeight: 700, color: "var(--text-primary)", whiteSpace: "nowrap" }}>
          Peak {peak.month.slice(0, 4)}
        </span>
      </div>
      <div style={{ position: "relative", height: 18, fontSize: ".72rem", color: "var(--text-secondary)" }}>
        {ticks.map((yr) => (
          <span key={yr} style={{ position: "absolute", left: pct(`${yr}-01-01`), transform: "translateX(-50%)" }}>{yr}</span>
        ))}
      </div>
    </figure>
  );
}
