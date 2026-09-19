"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { SkaterRosterRow, GoalieRosterRow } from "@/lib/roster-data";

type SortDir = "asc" | "desc";

function SortableHead<Row>({
  label,
  field,
  sort,
  setSort,
  align = "right",
}: {
  label: string;
  field: keyof Row;
  sort: { field: keyof Row; dir: SortDir };
  setSort: (s: { field: keyof Row; dir: SortDir }) => void;
  align?: "left" | "right";
}) {
  const active = sort.field === field;
  return (
    <th
      onClick={() => setSort({ field, dir: active && sort.dir === "desc" ? "asc" : "desc" })}
      style={{ cursor: "pointer", userSelect: "none", color: active ? "var(--gold)" : undefined, textAlign: align }}
      title={`Sort by ${label}`}
    >
      {label}
      {active ? (sort.dir === "desc" ? " ▾" : " ▴") : ""}
    </th>
  );
}

export function SkaterRosterTable({ rows }: { rows: SkaterRosterRow[] }) {
  const [sort, setSort] = useState<{ field: keyof SkaterRosterRow; dir: SortDir }>({ field: "points", dir: "desc" });

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
      <table className="box-score-table" style={{ minWidth: 720, padding: "0 18px" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Player</th>
            <SortableHead label="Pos" field="position" sort={sort} setSort={setSort} />
            <SortableHead label="GP" field="games" sort={sort} setSort={setSort} />
            <SortableHead label="G" field="goals" sort={sort} setSort={setSort} />
            <SortableHead label="A" field="assists" sort={sort} setSort={setSort} />
            <SortableHead label="P" field="points" sort={sort} setSort={setSort} />
            <SortableHead label="+/-" field="plus_minus" sort={sort} setSort={setSort} />
            <SortableHead label="PIM" field="pim" sort={sort} setSort={setSort} />
            <SortableHead label="S" field="shots" sort={sort} setSort={setSort} />
            <SortableHead label="HIT" field="hits" sort={sort} setSort={setSort} />
            <SortableHead label="BLK" field="blocks" sort={sort} setSort={setSort} />
            <SortableHead label="PPG" field="pp_goals" sort={sort} setSort={setSort} />
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
              <td>{r.position ?? "—"}</td>
              <td>{r.games}</td>
              <td>{r.goals}</td>
              <td>{r.assists}</td>
              <td style={{ fontWeight: 700, color: "var(--gold)" }}>{r.points}</td>
              <td>{r.plus_minus > 0 ? `+${r.plus_minus}` : r.plus_minus}</td>
              <td>{r.pim}</td>
              <td>{r.shots}</td>
              <td>{r.hits}</td>
              <td>{r.blocks}</td>
              <td>{r.pp_goals}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GoalieRosterTable({ rows }: { rows: GoalieRosterRow[] }) {
  const [sort, setSort] = useState<{ field: keyof GoalieRosterRow; dir: SortDir }>({ field: "wins", dir: "desc" });

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sort.field] ?? -Infinity;
      const bv = b[sort.field] ?? -Infinity;
      if (typeof av === "string" || typeof bv === "string") {
        return sort.dir === "desc" ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
      }
      return sort.dir === "desc" ? Number(bv) - Number(av) : Number(av) - Number(bv);
    });
    return copy;
  }, [rows, sort]);

  return (
    <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", overflowX: "auto" }}>
      <table className="box-score-table" style={{ minWidth: 560, padding: "0 18px" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Goalie</th>
            <SortableHead label="GP" field="games" sort={sort} setSort={setSort} />
            <SortableHead label="W" field="wins" sort={sort} setSort={setSort} />
            <SortableHead label="L" field="losses" sort={sort} setSort={setSort} />
            <SortableHead label="OTL" field="otl" sort={sort} setSort={setSort} />
            <SortableHead label="SO" field="shutouts" sort={sort} setSort={setSort} />
            <SortableHead label="SV%" field="savePct" sort={sort} setSort={setSort} />
            <SortableHead label="GAA" field="gaa" sort={sort} setSort={setSort} />
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
              <td>{r.wins}</td>
              <td>{r.losses}</td>
              <td>{r.otl}</td>
              <td>{r.shutouts}</td>
              <td style={{ fontWeight: 700, color: "var(--gold)" }}>{r.savePct != null ? r.savePct.toFixed(3) : "—"}</td>
              <td>{r.gaa != null ? r.gaa.toFixed(2) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
