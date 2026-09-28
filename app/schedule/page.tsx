import Link from "next/link";
import { getLatestSeasonId, getSeasonSchedule } from "@/lib/schedule-data";
import { getClubSeason, formatStartTimeET, isFinal, isInProgress } from "@/lib/nhl-schedule";
import { formatGameDate, formatSeasonLabel } from "@/lib/format-date";
import { Masthead, Footer } from "@/components/Masthead";

// Without this the page was prerendered once at build time and never
// picked up the hourly data refresh — same 5-minute window as every
// other data page.
export const revalidate = 300;

type Row = {
  id: number;
  date: string;
  gameType: "regular" | "playoff";
  isHome: boolean;
  opponent: string;
  // Result from our database (linked, narrated) or, for a game the NHL has
  // finished but the hourly refresh hasn't loaded yet, straight from the API.
  result: { team: number; opp: number; endType: string | null; loaded: boolean } | null;
  live: boolean;
  startTimeUTC: string | null;
  tv: string[];
  hasHighlight: boolean;
  hasRecap: boolean;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// The whole season, played and unplayed. Our database only holds completed
// games, so this page used to be a results list that stayed on last season
// until the new one's first boxscore loaded; the live NHL schedule now
// supplies everything not played yet. ?season=YYYYYYYY shows a past
// season from the database alone.
export default async function Schedule({ searchParams }: { searchParams: Promise<{ season?: string }> }) {
  const { season: requested } = await searchParams;
  const [club, latestLoaded] = await Promise.all([getClubSeason("BOS"), getLatestSeasonId("BOS")]);
  const currentSeason = club?.currentSeason ?? latestLoaded;
  const seasonId = requested && /^\d{8}$/.test(requested) ? requested : currentSeason;
  const stored = seasonId ? await getSeasonSchedule("BOS", seasonId) : [];
  const storedById = new Map(stored.map((g) => [Number(g.id), g]));

  const rows: Row[] =
    club && seasonId === club.currentSeason
      ? club.games
          .filter((g) => g.season === seasonId)
          .map((g) => {
            const s = storedById.get(g.id);
            return {
              id: g.id,
              date: g.gameDate,
              gameType: g.gameType === 3 ? "playoff" : "regular",
              isHome: g.isHome,
              opponent: g.opponent,
              result: s
                ? { team: s.team_score, opp: s.opp_score, endType: s.game_end_type, loaded: true }
                : isFinal(g) && g.teamScore != null && g.oppScore != null
                  ? { team: g.teamScore, opp: g.oppScore, endType: g.endType, loaded: false }
                  : null,
              live: isInProgress(g),
              startTimeUTC: g.startTimeUTC,
              tv: g.tv,
              hasHighlight: !!s?.has_highlight,
              hasRecap: !!s?.has_recap,
            };
          })
      : stored
          .filter((s) => s.game_type !== "preseason")
          .map((s) => ({
            id: Number(s.id),
            date: s.game_date.toISOString().slice(0, 10),
            gameType: s.game_type,
            isHome: s.is_home,
            opponent: s.opponent,
            result: { team: s.team_score, opp: s.opp_score, endType: s.game_end_type, loaded: true },
            live: false,
            startTimeUTC: null,
            tv: [],
            hasHighlight: s.has_highlight,
            hasRecap: s.has_recap,
          }));

  const played = rows.filter((r) => r.result && r.gameType === "regular");
  const w = played.filter((r) => r.result!.team > r.result!.opp).length;
  const l = played.filter((r) => r.result!.team < r.result!.opp && r.result!.endType === "regulation").length;
  const otl = played.length - w - l;
  const nextId = rows.find((r) => !r.result && !r.live)?.id;
  const regularCount = rows.filter((r) => r.gameType === "regular").length;
  const previousSeason = club?.previousSeason;

  return (
    <>
      <Masthead />
      <main style={{ maxWidth: 1160, margin: "0 auto", padding: "3rem 24px 3.5rem" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.2rem,4.5vw,3rem)", textTransform: "uppercase", letterSpacing: ".01em", margin: "0 0 .4rem" }}>
          {seasonId ? `${formatSeasonLabel(seasonId)} Schedule` : "Schedule"}
        </h1>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, flexWrap: "wrap", marginBottom: "1.5rem" }}>
          <p style={{ color: "var(--text-secondary)", fontSize: ".9rem", margin: 0 }}>
            Boston Bruins · {regularCount} regular-season games
            {played.length > 0 ? ` · ${w}-${l}-${otl}${played.length === regularCount || seasonId !== currentSeason ? " final" : " so far"}` : ""}
          </p>
          <p style={{ fontSize: ".82rem", margin: 0, display: "flex", gap: 16, flexWrap: "wrap" }}>
            {seasonId !== currentSeason && currentSeason && (
              <Link href="/schedule" style={{ color: "var(--gold)", textDecoration: "none", fontWeight: 600 }}>
                {formatSeasonLabel(currentSeason)} schedule →
              </Link>
            )}
            {seasonId === currentSeason && previousSeason && (
              <Link href={`/schedule?season=${previousSeason}`} style={{ color: "var(--gold)", textDecoration: "none", fontWeight: 600 }}>
                {formatSeasonLabel(previousSeason)} results →
              </Link>
            )}
          </p>
        </div>
        <p style={{ fontSize: ".78rem", color: "var(--text-secondary)", margin: "0 0 1rem" }}>
          <span style={{ color: "var(--gold)" }}>★</span> notable-game highlight · <span style={{ color: "var(--gold)" }}>●</span> recap · Times are Eastern
        </p>

        <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          <div className="schedule-row" style={{ padding: "10px 18px", fontSize: ".68rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", borderBottom: "1px solid var(--border)" }}>
            <span>Date</span>
            <span className="schedule-col-type">Type</span>
            <span>Matchup</span>
            <span>Result / Time</span>
          </div>
          {rows.map((r, i) => {
            const month = Number(r.date.slice(5, 7)) - 1;
            const newMonth = i === 0 || Number(rows[i - 1].date.slice(5, 7)) - 1 !== month;
            const won = r.result && r.result.team > r.result.opp;
            const isNext = r.id === nextId;
            const row = (
              <div
                className="schedule-row"
                style={{
                  padding: "12px 18px",
                  alignItems: "center",
                  fontSize: ".88rem",
                  borderTop: "1px solid var(--border)",
                  color: "var(--text-secondary)",
                  background: isNext || r.live ? "rgba(255,184,28,0.08)" : "transparent",
                  borderLeft: isNext || r.live ? "3px solid var(--gold)" : "3px solid transparent",
                }}
              >
                <span style={{ color: "var(--text-primary)" }}>{formatGameDate(r.date)}</span>
                <span className="schedule-col-type" style={{ fontSize: ".78rem" }}>
                  {r.gameType === "playoff" ? "Playoff" : isNext ? "Next" : ""}
                </span>
                <span style={{ color: "var(--text-primary)" }}>
                  {r.isHome ? "vs" : "@"} {r.opponent}
                  {(r.hasHighlight || r.hasRecap) && (
                    <span style={{ color: "var(--gold)", marginLeft: 8, fontSize: ".75rem" }} aria-label={r.hasHighlight ? "Notable-game highlight" : "Recap"}>
                      {r.hasHighlight ? "★" : "●"}
                    </span>
                  )}
                </span>
                <span>
                  {r.result ? (
                    <span style={{ color: won ? "var(--win)" : "var(--loss)", fontWeight: 700 }}>
                      {won ? "W" : r.result.endType === "regulation" || r.gameType === "playoff" ? "L" : "OTL"} {r.result.team}-{r.result.opp}
                      {r.result.endType === "overtime" ? " OT" : r.result.endType === "shootout" ? " SO" : ""}
                      {!r.result.loaded && <span style={{ color: "var(--text-secondary)", fontWeight: 400, fontSize: ".75rem" }}> · recap soon</span>}
                    </span>
                  ) : r.live ? (
                    <span style={{ color: "var(--gold)", fontWeight: 700 }}>In progress</span>
                  ) : r.startTimeUTC ? (
                    <span>
                      {formatStartTimeET(r.startTimeUTC, false).replace(" ET", "")}
                      {r.tv.length > 0 && <span style={{ fontSize: ".75rem" }}> · {r.tv.join(", ")}</span>}
                    </span>
                  ) : (
                    "—"
                  )}
                </span>
              </div>
            );
            return (
              <div key={r.id}>
                {newMonth && (
                  <div style={{ padding: "14px 18px 6px", borderTop: i === 0 ? "none" : "1px solid var(--border)", fontFamily: "var(--font-display)", fontSize: "1.05rem", letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text-primary)" }}>
                    {MONTHS[month]}
                  </div>
                )}
                {/* Every game links: a preview before it's loaded, the box
                    score after (same URL). */}
                <Link href={`/games/${r.id}`} style={{ display: "block", textDecoration: "none" }}>
                  {row}
                </Link>
              </div>
            );
          })}
          {rows.length === 0 && <p style={{ padding: "18px", color: "var(--text-secondary)", margin: 0 }}>No games on file for this season.</p>}
        </div>
      </main>
      <Footer />
    </>
  );
}
