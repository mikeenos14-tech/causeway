// The Causeway mark: a rafter banner with sweater-hem stripes and a
// custom-drawn C (approved 2026-10-01). Plain SVG with no hooks or <use>,
// so the same component renders in pages and in next/og image routes
// (favicon, home-screen icon, link-preview cards).
//
//   full     32px and up: rod, stripes, C
//   micro    under 32px (browser tab): banner and a larger C only
//   inverse  light backgrounds: gold banner, black details

const GOLD = "#ffb81c";
const INK = "#0a0a0b";

// Squared, condensed C (like a sweater number), drawn on the 64x80 banner grid.
const C_PATH = "M45 24.5 H29.5 Q19 24.5 19 34 V42 Q19 51.5 29.5 51.5 H45 V44.5 H31.5 Q26.5 44.5 26.5 39.5 V36.5 Q26.5 31.5 31.5 31.5 H45 Z";

export function BannerMark({ variant = "full", width, title }: { variant?: "full" | "micro" | "inverse"; width: number; title?: string }) {
  const height = Math.round((width * 80) / 64);
  const [edge, field] = variant === "inverse" ? [INK, GOLD] : [GOLD, INK];
  const a11y = title ? { role: "img", "aria-label": title } : { "aria-hidden": true };
  if (variant === "micro") {
    return (
      <svg width={width} height={height} viewBox="0 0 64 80" {...a11y}>
        <path d="M6 6 H58 V76 L32 65.5 L6 76 Z" fill={GOLD} />
        <path d="M10.5 10 H53.5 V69.6 L32 60.8 L10.5 69.6 Z" fill={INK} />
        <path d={C_PATH} fill={GOLD} transform="translate(32 38) scale(1.25) translate(-32 -38)" />
      </svg>
    );
  }
  return (
    <svg width={width} height={height} viewBox="0 0 64 80" {...a11y}>
      <rect x="2" y="3" width="60" height="4" rx="2" fill={edge} />
      <path d="M6 8 H58 V76 L32 65.5 L6 76 Z" fill={edge} />
      <path d="M9.5 11 H54.5 V70.8 L32 61.7 L9.5 70.8 Z" fill={field} />
      <rect x="9.5" y="14.5" width="45" height="3.2" fill={edge} />
      <rect x="9.5" y="19.2" width="45" height="1.6" fill={edge} />
      <rect x="9.5" y="55.4" width="45" height="1.6" fill={edge} />
      <rect x="9.5" y="58.5" width="45" height="3.2" fill={edge} />
      <path d={C_PATH} fill={edge} />
    </svg>
  );
}
