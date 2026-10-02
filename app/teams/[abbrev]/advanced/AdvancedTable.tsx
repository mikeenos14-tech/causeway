"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { AdvancedRosterRow } from "@/lib/roster-data";

type SortDir = "asc" | "desc";

function SortableHead({
  label,
  field,
  sort,
  setSort,
}: {
  label: string;
  field: keyof AdvancedRosterRow;
  sort: { field: keyof AdvancedRosterRow; dir: SortDir };
  setSort: (s: { field: keyof AdvancedRosterRow; dir: SortDir }) => void;
}) {
  const active = sort.field === field;
  return (
    <th
      onClick={() => setSort({ field, dir: active && sort.dir === "desc" ? "asc" : "desc" })}
      style={{ cursor: "pointer", userSelect: "none", color: active ? "var(--gold)" : undefined, textAlign: "right" }}
      title={`Sort by ${label}`}
    >
      {label}
      {active ? (sort.dir === "desc" ? " ▾" : " ▴") : ""}
    </th>
  );
}

function toi(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AdvancedTable({ rows }: { rows: AdvancedRosterRow[] }) {
  const [sort, setSort] = useState<{ field: keyof AdvancedRosterRow; dir: SortDir }>({ field: "goalsVsExpected", dir: "desc" });
  // Rate stats from a handful of games (a 4-game call-up at 60% xG share)
  // swamp the regulars, so the default view is players with at least a
  // quarter of the team's games — scales with the season, so it isn't
  // empty in October. One click shows everyone.
  const [showAll, setShowAll] = useState(false);
  const teamGames = rows.reduce((m, r) => Math.max(m, r.games), 0);
  const minGames = Math.max(1, Math.round(teamGames / 4));
  const hidden = rows.filter((r) => r.games < minGames).length;

  const sorted = useMemo(() => {
    const copy = rows.filter((r) => showAll || r.games >= minGames);
    copy.sort((a, b) => {
      const av = a[sort.field] ?? 0;
      const bv = b[sort.field] ?? 0;
      if (typeof av === "string" || typeof bv === "string") {
        return sort.dir === "desc" ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
      }
      return sort.dir === "desc" ? Number(bv) - Number(av) : Number(av) - Number(bv);
    });
    return copy;
  }, [rows, sort, showAll, minGames]);

  return (
    <>
    {hidden > 0 && (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 10, fontSize: ".82rem", color: "var(--text-secondary)" }}>
        <span>{showAll ? `All ${rows.length} players` : `Regulars: ${minGames}+ games played (${hidden} hidden)`}</span>
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 999, padding: "5px 12px", color: "var(--gold)", fontWeight: 600, fontSize: ".78rem", cursor: "pointer" }}
        >
          {showAll ? `Regulars only (${minGames}+ GP)` : `Show all ${rows.length}`}
        </button>
      </div>
    )}
    {/* Phones see only the first few columns; say there's more. */}
    <p className="swipe-hint">Swipe the table for more columns →</p>
    <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", overflowX: "auto" }}>
      <table className="box-score-table sticky-first" style={{ minWidth: 820, padding: "0 18px" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Player</th>
            <SortableHead label="GP" field="games" sort={sort} setSort={setSort} />
            <SortableHead label="TOI/GP" field="toiSecondsPerGame" sort={sort} setSort={setSort} />
            <SortableHead label="G" field="goals" sort={sort} setSort={setSort} />
            <SortableHead label="ixG" field="ixg" sort={sort} setSort={setSort} />
            <SortableHead label="G vs xG" field="goalsVsExpected" sort={sort} setSort={setSort} />
            <SortableHead label="ixG/60" field="ixgPer60" sort={sort} setSort={setSort} />
            <SortableHead label="iCorsi" field="icorsi" sort={sort} setSort={setSort} />
            <SortableHead label="On-Ice xG%" field="onIceXgPct" sort={sort} setSort={setSort} />
            <SortableHead label="On-Ice Corsi%" field="onIceCorsiPct" sort={sort} setSort={setSort} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id}>
              <td style={{ textAlign: "left" }}>
                <Link href={`/players/${r.id}`} style={{ color: "var(--text-primary)", textDecoration: "none", fontWeight: 600 }}>
                  {r.full_name}
                </Link>
              </td>
              <td>{r.games}</td>
              <td>{r.toiSecondsPerGame != null ? toi(r.toiSecondsPerGame) : "—"}</td>
              <td>{r.goals}</td>
              <td>{r.ixg.toFixed(1)}</td>
              <td style={{ fontWeight: 700, color: r.goalsVsExpected > 0 ? "var(--win)" : r.goalsVsExpected < 0 ? "var(--loss)" : "var(--text-secondary)" }}>
                {r.goalsVsExpected > 0 ? "+" : ""}
                {r.goalsVsExpected.toFixed(1)}
              </td>
              <td>{r.ixgPer60 != null ? r.ixgPer60.toFixed(2) : "—"}</td>
              <td>{r.icorsi}</td>
              <td>{r.onIceXgPct != null ? `${(r.onIceXgPct * 100).toFixed(1)}%` : "—"}</td>
              <td>{r.onIceCorsiPct != null ? `${(r.onIceCorsiPct * 100).toFixed(1)}%` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}
