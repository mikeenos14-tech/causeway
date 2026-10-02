// Two small, dependency-free SVG trend visuals — no charting library,
// consistent with how the rest of the site hand-rolls its icons (e.g. the
// search glyph on the Ask Causeway band). Both take plain arrays so any
// page can feed them real numbers without a new data shape.

// A row of win/loss bars for "recent form" — read at a glance faster than
// a line chart for a binary W/L sequence, which is why the homepage's old
// plain-text "W L L W" dots existed in the first place; this replaces that
// idea with something with real visual weight.
// An "OT" result (overtime/shootout loss) earns a point, so its bar sits
// between a win and a regulation loss, the way the standings treat it.
export function FormBars({ results, height = 28 }: { results: ("W" | "L" | "OT")[]; height?: number }) {
  if (results.length === 0) return null;
  const barWidth = 6;
  const gap = 3;
  const width = results.length * barWidth + (results.length - 1) * gap;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }} role="img" aria-label={`Last ${results.length}: ${results.join(" ")}`}>
      {results.map((r, i) => {
        const won = r === "W";
        const barHeight = won ? height : r === "OT" ? height * 0.75 : height * 0.55;
        return (
          <rect
            key={i}
            x={i * (barWidth + gap)}
            y={height - barHeight}
            width={barWidth}
            height={barHeight}
            rx={1.5}
            fill={won ? "var(--gold)" : "var(--border)"}
          />
        );
      })}
    </svg>
  );
}

// A smooth-ish line + area fill over a numeric series (e.g. points per
// season across a career). Values are normalized to the series' own
// min/max, not a fixed scale, so a rookie-to-prime arc and a steady
// role-player line both fill the same box meaningfully.
//
// `labels` (one per value) become hover titles on each point; `lastHollow`
// draws the last point as an open circle with a dashed final segment, for
// a season still in progress.
export function Sparkline({
  values,
  width = 140,
  height = 36,
  color = "var(--gold)",
  labels,
  lastHollow = false,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  labels?: string[];
  lastHollow?: boolean;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return [x, y] as const;
  });
  const linePath = points.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;
  // Solid line through the finished seasons; dashed into an in-progress one.
  const solidPoints = lastHollow ? points.slice(0, -1) : points;
  const solidPath = solidPoints.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lx, ly] = points[points.length - 1];
  const [px, py] = points[points.length - 2];
  const gradientId = "sparkline-fill";

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
      {solidPoints.length > 1 && <path d={solidPath} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />}
      {lastHollow && <path d={`M ${px.toFixed(1)} ${py.toFixed(1)} L ${lx.toFixed(1)} ${ly.toFixed(1)}`} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="2.5 2.5" />}
      <circle cx={lx} cy={ly} r={lastHollow ? 3 : 2.5} fill={lastHollow ? "var(--bg)" : color} stroke={color} strokeWidth={lastHollow ? 1.5 : 0} />
      {labels &&
        points.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={6} fill="transparent">
            <title>{labels[i]}</title>
          </circle>
        ))}
    </svg>
  );
}
