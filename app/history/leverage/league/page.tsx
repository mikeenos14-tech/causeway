import Link from "next/link";
import type { Metadata } from "next";
import { Masthead, Footer } from "@/components/Masthead";
import { SeasonPicker } from "@/components/SeasonPicker";
import { getLeverageLeaders, getLeverageSeasons, getBiggestGoals, playersWithPages, MIN_GOALS_TO_RANK, MIN_CAREER_GOALS_FOR_PERCENTILE, type LeaderSort } from "@/lib/leverage-data";
import { LeaderTable, GoalTable, LeverageNav, LeverageIntro, H2, SUB } from "@/components/LeverageTables";
import { formatSeasonLabel } from "@/lib/format-date";

// Leverage Goals, league-wide: any season since 1917-18, or all time.

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Leverage Goals Leaders · Causeway",
  description: "NHL scorers ranked by how much their goals changed the chance of winning, any season since 1917-18 or all time.",
};

const SORTS: Record<LeaderSort, string> = { lg: "Wins added", per: "Per goal", garbage: "Fewest decided-game goals", index: "Per goal vs league" };

export default async function LeverageLeaguePage({ searchParams }: { searchParams: Promise<{ season?: string; sort?: string; type?: string }> }) {
  const sp = await searchParams;
  const seasons = await getLeverageSeasons();
  const allTime = sp.season === "all";
  const season = allTime ? null : seasons.includes(sp.season ?? "") ? sp.season! : seasons[0];
  const type = sp.type === "playoff" ? "playoff" : "regular";
  const sort: LeaderSort = sp.sort === "per" || sp.sort === "garbage" || sp.sort === "index" ? sp.sort : "lg";
  const [rows, cupGoals] = await Promise.all([
    getLeverageLeaders({ season, gameType: type, sort, limit: 50 }),
    allTime && type === "playoff" ? getBiggestGoals("cup", { bruins: false, limit: 25 }) : Promise.resolve([]),
  ]);
  const linked = await playersWithPages(rows.map((r) => r.playerId).concat(cupGoals.map((g) => g.scorerId ?? 0)));
  const min = season ? MIN_GOALS_TO_RANK : MIN_CAREER_GOALS_FOR_PERCENTILE;

  const href = (o: { season?: string | null; sort?: LeaderSort; type?: string }) => {
    const q = new URLSearchParams();
    const s = o.season === undefined ? (allTime ? "all" : season) : o.season;
    if (s && s !== seasons[0]) q.set("season", s);
    const so = o.sort ?? sort;
    if (so !== "lg") q.set("sort", so);
    const t = o.type ?? type;
    if (t !== "regular") q.set("type", t);
    const qs = q.toString();
    return `/history/leverage/league${qs ? `?${qs}` : ""}`;
  };
  const chip = (on: boolean) => ({ padding: "5px 11px", borderRadius: 999, border: "1px solid var(--border)", fontSize: ".8rem", fontWeight: 600, textDecoration: "none", color: on ? "var(--ink)" : "var(--text-primary)", background: on ? "var(--gold)" : "transparent" });

  return (
    <>
      <Masthead />
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "2.5rem 24px 3.5rem" }}>
        <Link href="/history" style={{ fontSize: ".85rem", color: "var(--text-secondary)", textDecoration: "none" }}>
          ← Bruins history
        </Link>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.2rem,5vw,3.4rem)", lineHeight: 1, textTransform: "uppercase", margin: ".6rem 0 .8rem" }}>
          Goals That Moved Games
        </h1>
        <LeverageIntro />
        <LeverageNav active="league" />

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: "1rem" }}>
          <Link href={href({ season: "all" })} style={chip(allTime)} aria-current={allTime ? "page" : undefined}>
            All time
          </Link>
          <SeasonPicker seasons={seasons} current={season ?? seasons[0]} basePath="/history/leverage/league" mode="query" />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: ".6rem" }}>
          {(["regular", "playoff"] as const).map((t) => (
            <Link key={t} href={href({ type: t })} style={chip(type === t)}>
              {t === "regular" ? "Regular season" : "Playoffs"}
            </Link>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: "1.4rem" }}>
          {(Object.keys(SORTS) as LeaderSort[]).map((s) => (
            <Link key={s} href={href({ sort: s })} style={chip(sort === s)}>
              {s === "lg" && type === "playoff" ? "Series added" : SORTS[s]}
            </Link>
          ))}
        </div>

        {cupGoals.length > 0 && (
          <section style={{ marginBottom: "2.75rem" }}>
            <h2 style={H2}>Biggest goals in Stanley Cup history</h2>
            <p style={SUB}>
              Every playoff goal since 1926-27 by how much it moved its team&rsquo;s chance of winning the Cup: win chance added, times the game&rsquo;s
              series stakes, times how much the series mattered to the Cup (against the teams that actually played the later rounds).
            </p>
            <GoalTable goals={cupGoals} linked={linked} measure="cup" />
          </section>
        )}

        <h2 style={H2}>
          {allTime ? "All time" : formatSeasonLabel(season!)} · {type === "playoff" ? "Playoffs" : "Regular season"}
        </h2>
        <p style={SUB}>
          {sort === "lg"
            ? type === "playoff"
              ? "Series added: each goal's win chance added, weighted by how much its game mattered to the series."
              : "Wins added: the total win chance added by a player's goals."
            : `Players with ${min}+ goals${allTime ? " in their career" : " that season"}.`}
          {sort === "index" ? " Compared with the league's average goal in the seasons he played, so scoring eras are fair." : ""}
          {sort === "per" || sort === "index"
            ? " Per-goal value also reflects the team: goals for a dominant team often come with the game decided."
            : ""}
          {allTime && type === "playoff" ? " Two-game total-goals series (before 1938) have no series stakes." : ""}
        </p>
        {rows.length ? (
          <LeaderTable rows={rows} linked={linked} playoff={type === "playoff"} sortedByDecided={sort === "garbage"} />
        ) : (
          <p style={{ color: "var(--text-secondary)" }}>No one qualifies yet.</p>
        )}
      </main>
      <Footer />
    </>
  );
}
