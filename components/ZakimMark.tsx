// The Causeway mark: a gold C around the Zakim Bridge (owner's design,
// "1b. Zakim C, polished", 2026-10-02), redrawn as vector from the
// supplied PNG's own pixels: every centre line and width below was fitted
// to the artwork's anti-aliased edges (600x600 grid), and the drawing was
// checked against it pixel by pixel. Plain SVG with no hooks or <use>, so
// the same component renders in pages and in next/og image routes
// (favicon, home-screen icon, link-preview cards).
//
//   full     about 28px and up
//   micro    browser tab (16-32px): heavier lines, two cables a side,
//            since hairlines vanish at that size
//   inverse  light backgrounds: the bridge in ink instead of white

const GOLD = "#F2B01E";
const WHITE = "#F4F1EA";
const INK = "#0a0a0b";

// Square crop of the original 600x600 artwork around the mark. The
// coordinates below are pixel-centre fits (pixel n's centre is n), so the
// crop starts half a pixel up and left to line them up with the artwork.
const VIEWBOX = "164.5 106.5 271 271";
const CX = 299.5;
const CY = 242.5;

// The C: radius 101.3-128.5, open on the right between +40 and -40 degrees.
const R = 114.9;
const RING_W = 27.2;
const A = (40 * Math.PI) / 180;
const RING = `M${CX + R * Math.cos(A)} ${CY - R * Math.sin(A)} A${R} ${R} 0 1 0 ${CX + R * Math.cos(A)} ${CY + R * Math.sin(A)}`;

// Cables, 4.3 wide: [where they leave the mast's edge (y), where they meet
// the deck (distance out from the mast's edge at y 290)]. They start
// inside the mast so the mast covers their ends.
const CABLES: [number, number][] = [
  [166.0, 72.2],
  [184.6, 52.1],
  [204.0, 31.9],
];
const cable = (top: number, reach: number, side: -1 | 1) => {
  const edge = CX + side * 3.5;
  const x2 = edge + side * reach;
  const slope = (x2 - edge) / (290 - top); // dx per dy
  const y1 = top - (side * 3.5) / slope; // continue the line to the mast centre
  return { x1: CX, y1, x2, y2: 290 };
};

export function ZakimMark({ variant = "full", size, title }: { variant?: "full" | "micro" | "inverse"; size: number; title?: string }) {
  const a11y = title ? { role: "img", "aria-label": title } : { "aria-hidden": true };
  const bridge = variant === "inverse" ? INK : WHITE;
  const micro = variant === "micro";
  const k = micro ? 2 : 1; // line weight
  const cables = micro ? [CABLES[0], CABLES[2]] : CABLES;
  return (
    <svg width={size} height={size} viewBox={VIEWBOX} {...a11y}>
      {cables.flatMap(([top, reach]) =>
        ([-1, 1] as const).map((side) => {
          const c = cable(top, reach, side);
          return <line key={`${top}${side}`} {...c} stroke={GOLD} strokeWidth={4.3 * k} />;
        }),
      )}
      {/* Deck: from under the ring's inner edge out through the opening. */}
      <rect x={205} y={292.5 - 3.66 * k} width={225} height={7.32 * k} fill={bridge} />
      {/* Mast, then the inverted-Y legs, which pass through the deck and end in a flat cut. */}
      <rect x={CX - 4 * k} y={150} width={8 * k} height={92} fill={bridge} />
      <polygon points={`${295.9 - 4 * k},238 ${295.9 + 4 * k},238 ${270.5 + 4 * k},311.6 ${270.5 - 4 * k},311.6`} fill={bridge} />
      <polygon points={`${303.1 - 3.9 * k},238 ${303.1 + 3.9 * k},238 ${328.5 + 3.9 * k},311.6 ${328.5 - 3.9 * k},311.6`} fill={bridge} />
      <path d={RING} fill="none" stroke={GOLD} strokeWidth={RING_W * (micro ? 1.2 : 1)} />
    </svg>
  );
}
