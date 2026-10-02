import Link from "next/link";
import type { Metadata } from "next";
import { Masthead, Footer } from "@/components/Masthead";
import { TeamLogo } from "@/components/TeamLogo";
import { formatGameDate, formatSeasonLabel } from "@/lib/format-date";
import { getBruinsCups, getBruinsIconicGames, getBruinsSeasonLines, getBruinsSeriesRecord, type IconicGame, type SeasonLine } from "@/lib/history-hub-data";
import { getBruinsEloSeasons } from "@/lib/elo-seasons";
import { getBruinsBiggestGoals } from "@/lib/leverage-data";
import { DestinationCard } from "@/components/DestinationCard";

// Everything from 1924 on in one place: the six Cups, the iconic games and
// every season, each a link into the pages that hold the detail (game
// pages, the season schedule, Playoff History).

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Bruins History · Causeway",
  description: "Every Bruins season since 1924-25: the six Stanley Cups, the iconic games, and every season's record.",
};

const H2 = { fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.5rem", textTransform: "uppercase" as const, letterSpacing: ".02em", margin: "0 0 1rem" };
const CARD = { background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12 } as const;

// Decades by the year a season ended (1969-70 is in the 1970s), as fans
// count Cups; the same grouping as Playoff History and the season picker.
function byDecade<T>(items: T[], seasonOf: (t: T) => string): [string, T[]][] {
  const out: [string, T[]][] = [];
  for (const it of items) {
    const d = `${seasonOf(it).slice(4, 7)}0s`;
    const last = out.at(-1);
    if (last && last[0] === d) last[1].push(it);
    else out.push([d, [it]]);
  }
  return out;
}

export default async function HistoryPage() {
  const cups = await getBruinsCups();
  const [iconic, seasons, series, eloSeasons, [topGoal]] = await Promise.all([
    getBruinsIconicGames(),
    getBruinsSeasonLines(new Set(cups.map((c) => c.seasonId))),
    getBruinsSeriesRecord(),
    getBruinsEloSeasons(),
    getBruinsBiggestGoals("cup", 1),
  ]);
  // Teasers for the cards: the same #1s the linked pages open on.
  const ranked = eloSeasons.filter((s) => !s.current);
  const topSeason = [...ranked].sort((a, b) => b.peak - a.peak)[0];
  const rankedCount = ranked.length;
  const currentSeason = seasons[0]?.seasonId;

  return (
    <>
      <Masthead />
      <main style={{ maxWidth: 1160, margin: "0 auto", padding: "2.5rem 24px 3.5rem" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.4rem,5.5vw,4rem)", lineHeight: 0.98, textTransform: "uppercase", letterSpacing: ".01em", margin: "0 0 .6rem" }}>
          Bruins History
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: ".95rem", maxWidth: "62ch", margin: "0 0 2.5rem" }}>
          Every Bruins game since the first one, December 1, 1924, from the NHL&apos;s official game records. {seasons.length} seasons, {iconic.length} iconic games, six Stanley Cups.{" "}
        </p>

        <nav className="dest-cards" aria-label="More Bruins history">
          <DestinationCard href="/teams/BOS/playoffs" title="Every playoff series" teaser={`${series.series} series since ${formatSeasonLabel(series.since)}, ${series.won} won. Every round, every game.`} />
          <DestinationCard
            href="/history/elo"
            title="Every season, ranked"
            teaser={topSeason ? `#1: the ${formatSeasonLabel(topSeason.seasonId)} Bruins (${topSeason.record}). All ${rankedCount} seasons by Elo.` : "Every season by Elo."}
          />
          <DestinationCard
            href="/history/leverage"
            title="Biggest goals"
            teaser={topGoal ? `#1: ${topGoal.scorer}, ${topGoal.season.slice(4)} ${topGoal.stage}. Every goal since 1924, ranked.` : "Every goal since 1924, ranked by what it meant."}
          />
        </nav>

        <section style={{ marginBottom: "3rem" }}>
          <h2 style={H2}>Stanley Cups</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(250px, 100%), 1fr))", gap: 12 }}>
            {cups.map((c) => (
              <Link key={c.seasonId} href={`/games/${c.clincherId}`} style={{ ...CARD, padding: "1.1rem 1.25rem", textDecoration: "none", color: "inherit", display: "block" }}>
                <div style={{ fontFamily: "var(--font-display)", fontSize: "2.4rem", lineHeight: 1, color: "var(--gold)" }}>{c.year}</div>
                <div style={{ fontSize: ".88rem", color: "var(--text-primary)", margin: ".5rem 0 .35rem" }}>
                  Beat the {c.opponentName}, {c.teamWins}-{c.opponentWins}
                </div>
                <div style={{ fontSize: ".8rem", color: "var(--text-secondary)" }}>{c.clincherLabel ? `${c.clincherLabel} →` : "The clinching game →"}</div>
              </Link>
            ))}
          </div>
        </section>

        <section style={{ marginBottom: "3rem" }}>
          <h2 style={H2}>Iconic Games</h2>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {byDecade(iconic, (g) => g.season).map(([decade, list], i) => (
              <details key={decade} open={i === 0} className="decade">
                <summary className="decade-summary">
                  <span style={{ fontFamily: "var(--font-display)", fontSize: "1.4rem", textTransform: "uppercase" }}>{decade}</span>
                  <span style={{ fontSize: ".82rem", color: "var(--text-secondary)" }}>
                    {list.length} {list.length === 1 ? "game" : "games"}
                  </span>
                </summary>
                <div style={{ ...CARD, marginBottom: 12 }}>
                  {list.map((g, k) => (
                    <IconicRow key={g.id} g={g} first={k === 0} />
                  ))}
                </div>
              </details>
            ))}
          </div>
        </section>

        <section>
          <h2 style={H2}>Every Season</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: ".85rem", margin: "-.5rem 0 1rem" }}>Regular-season record as that era kept it: ties until 2004-05, overtime losses as their own column from 1999-2000.</p>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {byDecade(seasons, (s) => s.seasonId).map(([decade, list], i) => (
              <details key={decade} open={i === 0} className="decade">
                <summary className="decade-summary">
                  <span style={{ fontFamily: "var(--font-display)", fontSize: "1.4rem", textTransform: "uppercase" }}>{decade}</span>
                  <span style={{ fontSize: ".82rem", color: "var(--text-secondary)" }}>
                    {list.length} {list.length === 1 ? "season" : "seasons"}
                  </span>
                </summary>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(170px, 100%), 1fr))", gap: 8, paddingBottom: 12 }}>
                  {list.map((s) => (
                    <SeasonChip key={s.seasonId} s={s} current={s.seasonId === currentSeason} />
                  ))}
                </div>
              </details>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function IconicRow({ g, first }: { g: IconicGame; first: boolean }) {
  const result = g.team > g.opp ? "W" : g.team < g.opp ? "L" : "T";
  const end = g.finalState === "OT" ? (g.otPeriods > 1 ? ` ${g.otPeriods}OT` : " OT") : g.finalState === "SO" ? " SO" : "";
  return (
    <Link href={`/games/${g.id}`} style={{ display: "block", padding: "12px 16px", borderTop: first ? "none" : "1px solid var(--border)", textDecoration: "none", color: "inherit" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>{g.label}</span>
        <span style={{ fontSize: ".8rem", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
          {formatGameDate(g.date, true)} · {g.isHome ? "vs" : "@"} <TeamLogo abbrev={g.opponent} size={16} gap={3} />
          {g.opponent} ·{" "}
          <span style={{ fontWeight: 700, color: result === "W" ? "var(--win)" : result === "L" ? "var(--loss)" : "var(--text-secondary)" }}>
            {result} {g.team}-{g.opp}
            {end}
          </span>
        </span>
      </div>
      <div style={{ fontSize: ".84rem", color: "var(--text-secondary)", marginTop: 3, lineHeight: 1.45 }}>{g.story}</div>
    </Link>
  );
}

function SeasonChip({ s, current }: { s: SeasonLine; current: boolean }) {
  return (
    <Link
      href={current ? "/schedule" : `/schedule?season=${s.seasonId}`}
      style={{ ...CARD, padding: "10px 12px", textDecoration: "none", color: "inherit", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, borderColor: s.cup ? "var(--gold)" : "var(--border)" }}
    >
      <span style={{ fontFamily: "var(--font-display)", fontSize: "1.05rem" }}>{formatSeasonLabel(s.seasonId)}</span>
      <span style={{ fontSize: ".78rem", color: s.cup ? "var(--gold)" : "var(--text-secondary)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {s.record}
        {current ? " so far" : s.cup ? " · Cup" : ""}
      </span>
    </Link>
  );
}
