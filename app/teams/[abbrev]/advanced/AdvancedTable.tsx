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

export function AdvancedTable({ rows }: { rows: AdvancedRosterRow[] }) {
  const [sort, setSort] = useState<{ field: keyof AdvancedRosterRow; dir: SortDir }>({ field: "goalsVsExpected", dir: "desc" });

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sort.field] ?? 0;
      const bv = b[sort.field] ?? 0;
      if (typeof av === "string" || typeof bv === "string") {
        return sort.dir === "desc" ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
      }
      return sort.dir === "desc" ? Number(bv) - Number(av) : Number(av) - Number(bv);
    });
    return copy;
  }, [rows, sort]);

  return (
    <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", overflowX: "auto" }}>
      <table className="box-score-table" style={{ minWidth: 680, padding: "0 18px" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Player</th>
            <SortableHead label="GP" field="games" sort={sort} setSort={setSort} />
            <SortableHead label="G" field="goals" sort={sort} setSort={setSort} />
            <SortableHead label="ixG" field="ixg" sort={sort} setSort={setSort} />
            <SortableHead label="G vs xG" field="goalsVsExpected" sort={sort} setSort={setSort} />
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
              <td>{r.goals}</td>
              <td>{r.ixg.toFixed(1)}</td>
              <td style={{ fontWeight: 700, color: r.goalsVsExpected > 0 ? "var(--win)" : r.goalsVsExpected < 0 ? "var(--loss)" : "var(--text-secondary)" }}>
                {r.goalsVsExpected > 0 ? "+" : ""}
                {r.goalsVsExpected.toFixed(1)}
              </td>
              <td>{r.icorsi}</td>
              <td>{r.onIceXgPct != null ? `${(r.onIceXgPct * 100).toFixed(1)}%` : "—"}</td>
              <td>{r.onIceCorsiPct != null ? `${(r.onIceCorsiPct * 100).toFixed(1)}%` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
