// A team's current logo (the NHL's dark-background version), self-hosted in
// /public/logos so pages don't depend on the NHL's CDN. Only today's 32
// clubs plus Arizona (2014-24, in the site's 2007-on data) have one; any
// other code (the 1927 Senators, the Atlanta Thrashers, ...) renders
// nothing rather than a wrong or borrowed mark. A tri-code is never reused
// by a different franchise (the old Jets are WIN, the North Stars MNS), so
// an active code is always the same club.
//
// The NHL's files sit on a 3:2 canvas with padding around the mark, so the
// box is 1.5x as wide as it is tall and a negative left margin pulls the
// mark in line with the text column. Decorative (alt=""): the team's name
// is always printed beside it.

const CODES = new Set([
  "ANA", "BOS", "BUF", "CAR", "CBJ", "CGY", "CHI", "COL", "DAL", "DET", "EDM", "FLA", "LAK", "MIN", "MTL", "NJD",
  "NSH", "NYI", "NYR", "OTT", "PHI", "PIT", "SEA", "SJS", "STL", "TBL", "TOR", "UTA", "VAN", "VGK", "WPG", "WSH", "ARI",
]);

export const hasTeamLogo = (abbrev: string | null | undefined) => !!abbrev && CODES.has(abbrev);

export function TeamLogo({ abbrev, size = 22, gap = 6 }: { abbrev: string | null | undefined; size?: number; gap?: number }) {
  if (!abbrev || !CODES.has(abbrev)) return null;
  const width = Math.round(size * 1.5);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static SVG; next/image adds nothing here
    <img
      src={`/logos/${abbrev}.svg`}
      alt=""
      width={width}
      height={size}
      loading="lazy"
      decoding="async"
      style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0, marginLeft: -Math.round(size * 0.22), marginRight: gap - Math.round(size * 0.22), marginTop: -3, marginBottom: -3 }}
    />
  );
}
