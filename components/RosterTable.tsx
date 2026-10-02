"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { SkaterRosterRow, GoalieRosterRow } from "@/lib/roster-data";
import type { RosterFlags } from "@/lib/current-roster";
import { Headshot } from "@/components/Headshot";
import { formatSavePct } from "@/lib/util/save-pct";

type SortDir = "asc" | "desc";

function toi(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function SortableHead<Row>({
  label,
  field,
  sort,
  setSort,
  align = "right",
  hint,
}: {
  label: string;
  field: keyof Row;
  sort: { field: keyof Row; dir: SortDir };
  setSort: (s: { field: keyof Row; dir: SortDir }) => void;
  align?: "left" | "right";
  hint?: string;
}) {
  const active = sort.field === field;
  return (
    <th
      onClick={() => setSort({ field, dir: active && sort.dir === "desc" ? "asc" : "desc" })}
      style={{ cursor: "pointer", userSelect: "none", color: active ? "var(--gold)" : undefined, textAlign: align }}
      title={hint ? `${hint} — sort` : `Sort by ${label}`}
    >
      {label}
      {active ? (sort.dir === "desc" ? " ▾" : " ▴") : ""}
    </th>
  );
}

// Players who haven't played yet (GP 0) always sit at the bottom, whatever
// the sort: they have no numbers to rank. Ties break on GP, then name.
function compareRows<R extends { games: number; full_name: string }>(a: R, b: R, field: keyof R, dir: SortDir, missing: number) {
  if ((a.games === 0) !== (b.games === 0)) return a.games === 0 ? 1 : -1;
  const av = a[field] ?? missing;
  const bv = b[field] ?? missing;
  let c: number;
  if (typeof av === "string" || typeof bv === "string") c = dir === "desc" ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
  else c = dir === "desc" ? Number(bv) - Number(av) : Number(av) - Number(bv);
  return c || b.games - a.games || a.full_name.localeCompare(b.full_name);
}

// The name cell: photo, name (linked when he has a player page), C/A, and
// a note when he played here this season but is off the roster now.
function NameCell({ r, headshot, badge }: { r: { id: number; full_name: string } & Partial<RosterFlags>; headshot?: string; badge?: "C" | "A" }) {
  return (
    <td style={{ textAlign: "left" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, verticalAlign: "middle" }}>
        <Headshot url={headshot} name={r.full_name} size={28} />
        {r.hasPage === false ? (
          <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{r.full_name}</span>
        ) : (
          <Link href={`/players/${r.id}`} style={{ color: "var(--text-primary)", textDecoration: "none", fontWeight: 600 }}>
            {r.full_name}
          </Link>
        )}
      </span>
      <Badge b={badge} />
      {r.onRoster === false && <span style={{ display: "block", marginLeft: 36, fontSize: ".7rem", color: "var(--text-muted)" }}>not on current roster</span>}
    </td>
  );
}

// A gold "C" / "A" after a name, for the season the designation applies to.
function Badge({ b }: { b?: "C" | "A" }) {
  if (!b) return null;
  return (
    <span title={b === "C" ? "Captain" : "Alternate captain"} style={{ marginLeft: 6, fontSize: ".68rem", fontWeight: 700, color: "var(--ink)", background: "var(--gold)", borderRadius: 3, padding: "0 4px" }}>
      {b}
    </span>
  );
}

// Columns a season can leave out (ones its era didn't track): older
// seasons from the NHL's boxscores have no ice time, hits, blocks or PP
// goals here, and no shots or plus-minus before 1959-60.
export type SkaterColumn = "plus_minus" | "toi" | "shots" | "hits" | "blocks" | "pp_goals";

type SkaterCol = { key: string; label: string; field: keyof SkaterRosterRow; hint?: string; omit?: SkaterColumn; cell: (r: SkaterRosterRow) => React.ReactNode };
const SKATER_COLS: SkaterCol[] = [
  { key: "g", label: "G", field: "goals", cell: (r) => r.goals },
  { key: "a", label: "A", field: "assists", cell: (r) => r.assists },
  { key: "p", label: "P", field: "points", cell: (r) => <span style={{ fontWeight: 700, color: "var(--gold)" }}>{r.points}</span> },
  { key: "pm", label: "+/-", field: "plus_minus", omit: "plus_minus", cell: (r) => (r.plus_minus > 0 ? `+${r.plus_minus}` : r.plus_minus) },
  { key: "toi", label: "TOI/GP", field: "toiSecondsPerGame", omit: "toi", cell: (r) => toi(r.toiSecondsPerGame) },
  { key: "pim", label: "PIM", field: "pim", cell: (r) => r.pim },
  { key: "s", label: "S", field: "shots", omit: "shots", cell: (r) => r.shots },
  { key: "sp", label: "S%", field: "shootingPct", omit: "shots", cell: (r) => (r.shootingPct != null ? `${(r.shootingPct * 100).toFixed(1)}%` : "—") },
  { key: "hit", label: "HIT", field: "hits", omit: "hits", cell: (r) => r.hits },
  { key: "blk", label: "BLK", field: "blocks", omit: "blocks", cell: (r) => r.blocks },
  { key: "ppg", label: "PPG", field: "pp_goals", hint: "Power-play goals", omit: "pp_goals", cell: (r) => r.pp_goals },
];

export function SkaterRosterTable({
  rows,
  badges = {},
  headshots = {},
  omit = [],
}: {
  rows: (SkaterRosterRow & Partial<RosterFlags>)[];
  badges?: Record<number, "C" | "A">;
  headshots?: Record<number, string>;
  omit?: SkaterColumn[];
}) {
  const [sort, setSort] = useState<{ field: keyof SkaterRosterRow; dir: SortDir }>({ field: "points", dir: "desc" });
  const cols = SKATER_COLS.filter((c) => !c.omit || !omit.includes(c.omit));

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => compareRows(a, b, sort.field, sort.dir, 0));
    return copy;
  }, [rows, sort]);

  return (
    <>
    {/* Phones see only the first few columns; say there's more (the
        default sort column, points, is off-screen at 375px). */}
    <p className="swipe-hint">Swipe the table for more columns →</p>
    <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", overflowX: "auto" }}>
      <table className="box-score-table sticky-first" style={{ minWidth: cols.length > 8 ? 860 : 560, padding: "0 18px" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Player</th>
            <SortableHead label="Pos" field="position" sort={sort} setSort={setSort} />
            <SortableHead label="GP" field="games" sort={sort} setSort={setSort} />
            {cols.map((c) => (
              <SortableHead key={c.key} label={c.label} hint={c.hint} field={c.field} sort={sort} setSort={setSort} />
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id}>
              <NameCell r={r} headshot={headshots[r.id]} badge={badges[r.id]} />
              <td>{r.position ?? "—"}</td>
              <td>{r.games}</td>
              {cols.map((c) =>
                // Hasn't played yet: no numbers, not zeros.
                r.games === 0 ? (
                  <td key={c.key} style={{ color: "var(--text-muted)" }}>
                    —
                  </td>
                ) : (
                  <td key={c.key}>{c.cell(r)}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

// ties: show a T column (seasons before 2005-06). otl: show OTL (from
// 1999-2000; before that an overtime loss was a loss). gaa: goals against
// average needs ice time, which older seasons don't all have.
export function GoalieRosterTable({
  rows,
  badges = {},
  headshots = {},
  ties = false,
  otl = true,
}: {
  rows: (GoalieRosterRow & Partial<RosterFlags> & { ties?: number })[];
  badges?: Record<number, "C" | "A">;
  headshots?: Record<number, string>;
  ties?: boolean;
  otl?: boolean;
}) {
  const [sort, setSort] = useState<{ field: keyof GoalieRosterRow; dir: SortDir }>({ field: "wins", dir: "desc" });

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => compareRows(a, b, sort.field, sort.dir, -Infinity));
    return copy;
  }, [rows, sort]);
  const statCount = 5 + (ties ? 1 : 0) + (otl ? 1 : 0);

  return (
    <>
    {/* Phones see only the first few columns; say there's more (the
        default sort column, points, is off-screen at 375px). */}
    <p className="swipe-hint">Swipe the table for more columns →</p>
    <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", overflowX: "auto" }}>
      <table className="box-score-table sticky-first" style={{ minWidth: 560, padding: "0 18px" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Goalie</th>
            <SortableHead label="GP" field="games" sort={sort} setSort={setSort} />
            <SortableHead label="W" field="wins" sort={sort} setSort={setSort} />
            <SortableHead label="L" field="losses" sort={sort} setSort={setSort} />
            {ties && <th>T</th>}
            {otl && <SortableHead label="OTL" field="otl" sort={sort} setSort={setSort} />}
            <SortableHead label="SO" field="shutouts" sort={sort} setSort={setSort} />
            <SortableHead label="SV%" field="savePct" sort={sort} setSort={setSort} />
            <SortableHead label="GAA" field="gaa" sort={sort} setSort={setSort} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id}>
              <NameCell r={r} headshot={headshots[r.id]} badge={badges[r.id]} />
              <td>{r.games}</td>
              {r.games === 0 ? (
                Array.from({ length: statCount }, (_, i) => <td key={i} style={{ color: "var(--text-muted)" }}>—</td>)
              ) : (
                <>
                  <td>{r.wins}</td>
                  <td>{r.losses}</td>
                  {ties && <td>{r.ties ?? 0}</td>}
                  {otl && <td>{r.otl}</td>}
                  <td>{r.shutouts}</td>
                  <td style={{ fontWeight: 700, color: "var(--gold)" }}>{formatSavePct(r.savePct)}</td>
                  <td>{r.gaa != null ? r.gaa.toFixed(2) : "—"}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}
