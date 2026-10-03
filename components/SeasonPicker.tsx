"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { seasonPath } from "@/lib/season-path";

// Pick any season: a native select (the phone's own scroll wheel, which
// handles 100 seasons comfortably) grouped by decade, plus older / newer
// arrows for stepping one season at a time. The arrows are plain links, so
// paging works even before the page's JavaScript loads.

const label = (s: string) => `${s.slice(0, 4)}-${s.slice(6)}`;

// mode "path" links to basePath/2010-11 (cacheable pages); "query" to
// basePath?season=20102011 for pages that combine it with other filters.
export function SeasonPicker({ seasons, current, basePath, mode = "path" }: { seasons: string[]; current: string; basePath: string; mode?: "path" | "query" }) {
  const router = useRouter();
  const sorted = [...seasons].sort().reverse(); // newest first
  const i = sorted.indexOf(current);
  const newer = i > 0 ? sorted[i - 1] : null;
  const older = i >= 0 && i < sorted.length - 1 ? sorted[i + 1] : null;
  const href = (s: string) => (s === sorted[0] ? basePath : mode === "path" ? `${basePath}/${seasonPath(s)}` : `${basePath}?season=${s}`);

  const decades = new Map<string, string[]>();
  for (const s of sorted) {
    // By the year the season ended (1969-70 is in the 1970s), as fans count Cups.
    const d = `${s.slice(4, 7)}0s`;
    decades.set(d, [...(decades.get(d) ?? []), s]);
  }

  const arrow = { color: "var(--gold)", textDecoration: "none", fontWeight: 600, padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: ".85rem", whiteSpace: "nowrap" as const };
  const disabled = { ...arrow, color: "var(--text-muted)", pointerEvents: "none" as const, opacity: 0.5 };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {older ? (
        <Link href={href(older)} style={arrow} aria-label={`Previous season, ${label(older)}`}>
          ← {label(older)}
        </Link>
      ) : (
        <span style={disabled}>←</span>
      )}
      <label style={{ position: "relative" }}>
        <span className="sr-only">Season</span>
        <select
          value={current}
          onChange={(e) => router.push(href(e.target.value))}
          className="season-select"
          aria-label="Choose a season"
        >
          {[...decades].map(([decade, list]) => (
            <optgroup key={decade} label={decade}>
              {list.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {newer ? (
        <Link href={href(newer)} style={arrow} aria-label={`Next season, ${label(newer)}`}>
          {label(newer)} →
        </Link>
      ) : (
        <span style={disabled}>→</span>
      )}
    </div>
  );
}
