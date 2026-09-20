"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Replaces the old "→" link row that used to live inside StatLeaders —
// that worked when there were two sub-pages, but wrapped into a cramped
// 2x2 grid of text links on mobile once Records and Season Series joined
// Roster and League (confirmed live at 375px before building this). A
// real tab bar scales the way that link row didn't.
const TABS = [
  { label: "Overview", path: "" },
  { label: "Roster", path: "/roster" },
  { label: "League", path: "/league" },
  { label: "Records", path: "/records" },
  { label: "Series", path: "/series" },
  { label: "Playoffs", path: "/playoffs" },
  { label: "Advanced", path: "/advanced" },
];

export function TeamSubNav({ abbrev }: { abbrev: string }) {
  const pathname = usePathname();
  const base = `/teams/${abbrev}`;

  return (
    <nav
      style={{
        display: "flex",
        gap: 4,
        width: "100%",
        minWidth: 0,
        maxWidth: "100%",
        overflowX: "auto",
        borderBottom: "1px solid var(--border)",
        marginBottom: "2rem",
      }}
    >
      {TABS.map((tab) => {
        const href = `${base}${tab.path}`;
        // Overview also matches the homepage itself when that's BOS, so a
        // Bruins visitor sees it highlighted from "/" too, not just
        // "/teams/BOS".
        const active = tab.path === "" ? pathname === base || (pathname === "/" && abbrev === "BOS") : pathname === href;
        return (
          <Link
            key={tab.label}
            href={href}
            style={{
              padding: "10px 16px",
              fontSize: ".85rem",
              fontWeight: 600,
              whiteSpace: "nowrap",
              color: active ? "var(--gold)" : "var(--text-secondary)",
              textDecoration: "none",
              borderBottom: active ? "2px solid var(--gold)" : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
