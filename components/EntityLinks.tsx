import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

// Every team and player name on the site links to its page, but only when
// that page exists and says something: today's 32 clubs (a defunct club's
// code, ATL or QUE, has no team page), and players who have a page (the
// caller says whether; players from before 2007-08 mostly don't). Never a
// link to a page that doesn't make sense.

export const ACTIVE_TEAMS = new Set([
  "ANA", "BOS", "BUF", "CAR", "CBJ", "CGY", "CHI", "COL", "DAL", "DET", "EDM", "FLA", "LAK", "MIN", "MTL", "NJD",
  "NSH", "NYI", "NYR", "OTT", "PHI", "PIT", "SEA", "SJS", "STL", "TBL", "TOR", "UTA", "VAN", "VGK", "WPG", "WSH",
]);

export const hasTeamPage = (abbrev: string | null | undefined) => !!abbrev && ACTIVE_TEAMS.has(abbrev);

export function TeamLink({ abbrev, children, style, className = "entity-link" }: { abbrev: string | null | undefined; children?: ReactNode; style?: CSSProperties; className?: string }) {
  const label = children ?? abbrev;
  if (!hasTeamPage(abbrev)) return <span style={style}>{label}</span>;
  return (
    <Link href={`/teams/${abbrev}`} className={className} style={style}>
      {label}
    </Link>
  );
}

// hasPage: whether this player has a page (players table). Unknown or
// false renders the name as plain text.
export function PlayerLink({ id, hasPage = true, children, style, className = "entity-link" }: { id: number | null | undefined; hasPage?: boolean; children: ReactNode; style?: CSSProperties; className?: string }) {
  if (!id || !hasPage) return <span style={style}>{children}</span>;
  return (
    <Link href={`/players/${id}`} className={className} style={style}>
      {children}
    </Link>
  );
}
