import Link from "next/link";
import type { Metadata } from "next";
import { Masthead, Footer } from "@/components/Masthead";
import { formatSeasonLabel } from "@/lib/format-date";
import { getBruinsEloSeasons, type EloSeason } from "@/lib/elo-seasons";

// Every completed Bruins season ranked by Elo (lib/elo-seasons.ts).

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Every Bruins Season, Ranked · Causeway",
  description: "All Bruins seasons since 1924-25 ranked by Elo: how dominant each team was in its own league.",
};

const SORTS = { peak: "Peak", avg: "Season average", final: "Final" } as const;
type Sort = keyof typeof SORTS;

export default async function EloSeasonsPage({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const { sort: raw } = await searchParams;
  const sort: Sort = raw === "avg" || raw === "final" ? raw : "peak";
  const all = await getBruinsEloSeasons();
  const current = all.find((s) => s.current);
  const seasons = all.filter((s) => !s.current).sort((a, b) => b[sort] - a[sort]);

  return (
    <>
      <Masthead />
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "2.5rem 24px 3.5rem" }}>
        <Link href="/history" style={{ fontSize: ".85rem", color: "var(--text-secondary)", textDecoration: "none" }}>
          ← Bruins history
        </Link>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.2rem,5vw,3.4rem)", lineHeight: 1, textTransform: "uppercase", margin: ".6rem 0 .8rem" }}>
          Every Bruins Season, Ranked
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: ".92rem", maxWidth: "68ch", lineHeight: 1.55, margin: "0 0 .75rem" }}>
          By Elo: a rating every NHL team carries from game to game since 1917, rising with wins (more for bigger margins and tougher opponents)
          and falling with losses. The league average is held at about 1505, so a rating says how far above its own league a team was. That makes
          this a ranking of dominance in its time, not a guess at who would win across eras.
        </p>
        <p style={{ color: "var(--text-muted)", fontSize: ".8rem", margin: "0 0 1.5rem" }}>
          Peak: the highest the team reached. Season average: over the regular season. Final: after its last game, playoffs included.
          {current ? ` ${formatSeasonLabel(current.seasonId)} is ranked once it's over (now ${Math.round(current.final)}).` : ""}
        </p>
        <nav aria-label="Sort by" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: "1rem", fontSize: ".82rem" }}>
          <span style={{ color: "var(--text-secondary)", alignSelf: "center" }}>Rank by</span>
          {(Object.keys(SORTS) as Sort[]).map((k) => (
            <Link
              key={k}
              href={k === "peak" ? "/history/elo" : `/history/elo?sort=${k}`}
              aria-current={k === sort ? "page" : undefined}
              style={{ padding: "4px 12px", borderRadius: 999, border: "1px solid var(--border)", textDecoration: "none", color: k === sort ? "var(--ink)" : "var(--text-secondary)", background: k === sort ? "var(--gold)" : "transparent", fontWeight: 600 }}
            >
              {SORTS[k]}
            </Link>
          ))}
        </nav>
        <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          <table className="box-score-table elo-seasons" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", width: 40 }}>#</th>
                <th style={{ textAlign: "left" }}>Season</th>
                <th className={sort === "peak" ? undefined : "elo-col-optional"}>Peak</th>
                <th className={sort === "avg" ? undefined : "elo-col-optional"}>Avg</th>
                <th className={sort === "final" ? undefined : "elo-col-optional"}>Final</th>
                <th className="elo-col-optional">Record</th>
                <th style={{ textAlign: "left" }}>Result</th>
              </tr>
            </thead>
            <tbody>
              {seasons.map((s, i) => (
                <Row key={s.seasonId} s={s} rank={i + 1} sort={sort} />
              ))}
            </tbody>
          </table>
        </div>
      </main>
      <Footer />
    </>
  );
}

function Row({ s, rank, sort }: { s: EloSeason; rank: number; sort: Sort }) {
  const cell = (k: Sort) => (
    <td className={sort === k ? undefined : "elo-col-optional"} style={{ fontWeight: sort === k ? 700 : 400, color: sort === k ? "var(--gold)" : undefined }}>
      {Math.round(s[k])}
    </td>
  );
  return (
    <tr>
      <td style={{ textAlign: "left", color: "var(--text-secondary)" }}>{rank}</td>
      <td style={{ textAlign: "left" }}>
        <Link href={`/schedule?season=${s.seasonId}`} style={{ color: "var(--text-primary)", textDecoration: "none", fontWeight: 600 }}>
          {formatSeasonLabel(s.seasonId)}
        </Link>
      </td>
      {cell("peak")}
      {cell("avg")}
      {cell("final")}
      <td className="elo-col-optional">{s.record}</td>
      <td style={{ textAlign: "left", color: s.cup ? "var(--gold)" : "var(--text-secondary)", fontWeight: s.cup ? 700 : 400 }}>{s.outcome}</td>
    </tr>
  );
}
