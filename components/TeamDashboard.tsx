// The team dashboard — the homepage (Boston) and every /teams/[abbrev]
// overview render this one component, so a fix to how a season, a game
// day, or a result is presented lands everywhere at once. (They were two
// copies of the same page before, already drifting apart.)
//
// Season awareness, the reason this exists: the database only holds
// completed games, so "the current season" for every stat module is the
// season of this team's latest completed game — no hardcoded year, and no
// waiting for the rest of the league. The live NHL schedule
// (lib/nhl-schedule.ts) supplies what the database can't know yet: that a
// new season has started, the next game, and a game that's in progress or
// just ended but hasn't been loaded by the hourly refresh.

import Link from "next/link";
import {
  getLatestGame,
  getRecentForm,
  getRecentResults,
  getDivisionStandings,
  getStatLeaders,
  getHomeRoadSplit,
  getSeasonSummary,
  type RecentCard,
  type FormResult,
} from "@/lib/homepage-data";
import { getLatestSeasonId } from "@/lib/schedule-data";
import { getAllSeasonSeriesForTeam } from "@/lib/season-series-data";
import { getUpcomingMilestones, milestoneText } from "@/lib/milestones-data";
import { getClubSeason, isFinal, isInProgress, formatStartTimeET, openerTag, chooseHero, type ClubGame } from "@/lib/nhl-schedule";
import { nextGameFlavor } from "@/lib/next-game";
import { roundLabel } from "@/lib/playoff-data";
import { formatGameDate, formatSeasonLabel } from "@/lib/format-date";
import { StatLeaders } from "@/components/StatLeaders";
import { RosterMovesCard } from "@/components/RosterMovesCard";
import { getRosterMoves } from "@/lib/roster-moves";
import { getCurrentCaptainName } from "@/lib/leadership";
import { FormBars } from "@/components/Sparkline";

const H2 = { margin: 0, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.5rem", textTransform: "uppercase" as const, letterSpacing: ".02em" };
const TILE_LABEL = { fontSize: ".78rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase" as const, letterSpacing: ".06em", marginBottom: 8 };
const CAPTION = { fontSize: ".78rem", color: "var(--text-secondary)" };

function resultLabel(teamScore: number, oppScore: number, gameEndType: string | null) {
  if (teamScore > oppScore) return gameEndType === "overtime" ? "W (OT)" : gameEndType === "shootout" ? "W (SO)" : "W";
  if (gameEndType === "overtime") return "OTL";
  if (gameEndType === "shootout") return "SOL";
  return "L";
}

const isoDate = (d: Date | string) => (d instanceof Date ? d.toISOString().slice(0, 10) : d.slice(0, 10));
const etDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);

// "Tonight" / "Tomorrow" / "Tue, Sep 29" — relative to now in Eastern time.
function whenLabel(game: ClubGame, now: number): string {
  const start = new Date(game.startTimeUTC);
  const today = etDay(new Date(now));
  const tomorrow = etDay(new Date(now + 24 * 3600 * 1000));
  if (etDay(start) === today) return "Tonight";
  if (etDay(start) === tomorrow) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" }).format(start);
}

export async function TeamDashboard({ abbrev, compact = false }: { abbrev: string; compact?: boolean }) {
  // Rendered per request (ISR), so "now" is the render time — the pages
  // revalidate every 5 minutes, which bounds how stale "Tonight" can be.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const [club, seasonId, lastGame] = await Promise.all([getClubSeason(abbrev), getLatestSeasonId(abbrev), getLatestGame(abbrev)]);

  const [form, recent, standings, statLeaders, homeRoadSplit, milestones] = seasonId
    ? await Promise.all([
        getRecentForm(abbrev, seasonId),
        getRecentResults(abbrev, seasonId),
        getDivisionStandings(abbrev, seasonId),
        getStatLeaders(abbrev, seasonId),
        getHomeRoadSplit(abbrev, seasonId),
        getUpcomingMilestones(abbrev, seasonId),
      ])
    : [[] as FormResult[], [] as RecentCard[], null, null, null, []];

  // --- Where are we in the season? ------------------------------------
  const seasonLabel = seasonId ? formatSeasonLabel(seasonId) : null;
  // The NHL has moved on to a new season but this team hasn't played in it
  // yet (the offseason, or the first days of a new season) — every stat
  // module below still describes the previous season, and says so.
  const newSeasonPending = !!(club && seasonId && club.currentSeason !== seasonId);
  const regularSeasonDone = !!(club && seasonId && !club.games.some((g) => g.season === seasonId && g.gameType === 2 && !isFinal(g)));
  const ownStanding = standings?.teams.find((t) => t.abbrev === abbrev) ?? null;
  const gp = ownStanding ? ownStanding.wins + ownStanding.losses + ownStanding.ot_losses : 0;
  const seasonCaption = !seasonLabel
    ? null
    : newSeasonPending || regularSeasonDone
      ? `${seasonLabel} regular season · final`
      : `${seasonLabel} regular season · ${gp} game${gp === 1 ? "" : "s"} played`;

  // --- What goes in the hero? ------------------------------------------
  const lastDate = lastGame ? isoDate(lastGame.game_date) : null;
  const { hero, pending, next, daysSinceLast } = chooseHero(club?.games ?? [], lastGame ? { id: lastGame.id, date: lastDate! } : null, now);

  // Grounded context for the preview, all from our own data: head-to-head
  // this season (or last season's, before this team's first game), and how
  // last season ended when a new one is about to start.
  const [h2hRows, lastSeason] =
    hero === "preview" && next && seasonId
      ? await Promise.all([getAllSeasonSeriesForTeam(abbrev, seasonId), newSeasonPending ? getSeasonSummary(abbrev, seasonId) : Promise.resolve(null)])
      : [[], null];
  const h2h = next ? h2hRows.find((r) => r.opp_abbrev === next.opponent) : undefined;

  // Roster changes matter most around the turn of a season: before this
  // team's first game and through its first 10.
  const showMoves = !!club && (newSeasonPending || gp < 10);
  const [moves, captainName] = showMoves
    ? await Promise.all([getRosterMoves(abbrev, club!.previousSeason), getCurrentCaptainName(abbrev, club!.currentSeason)])
    : [null, null];

  const teamName = club?.teamName ?? abbrev;
  const titleSize = compact ? "clamp(1.9rem,4.5vw,2.8rem)" : "clamp(2.6rem,8vw,4.75rem)";

  return (
    <>
      {/* HERO */}
      {hero !== "none" && (
        <section className="dash-hero" style={{ padding: compact ? "1.5rem 0 2rem" : "3.25rem 0 2.75rem", borderBottom: "1px solid var(--border)", position: "relative", overflow: "hidden" }}>
          {!compact && (
            <div
              aria-hidden
              style={{
                position: "absolute",
                right: "-15%",
                top: "-40%",
                width: "55%",
                height: "180%",
                // closest-side keeps the glow's fade inside the box on tall
                // mobile heroes (farthest-corner sizing read as a hard edge).
                background: "radial-gradient(circle closest-side, rgba(255,184,28,0.09) 0%, rgba(255,184,28,0) 100%)",
                pointerEvents: "none",
              }}
            />
          )}
          <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 32, flexWrap: "wrap" }}>
            {hero === "preview" && next && (
              <PreviewHero
                game={next}
                tag={(club && openerTag(club, next)) ?? (next.gameType === 3 ? "Playoffs" : whenLabel(next, now))}
                when={whenLabel(next, now)}
                teamName={teamName}
                abbrev={abbrev}
                titleSize={titleSize}
                h2hLine={
                  h2h
                    ? `${newSeasonPending ? "Last season" : "This season"} vs ${next.opponent}: ${h2h.wins}-${h2h.losses}-${h2h.otl}`
                    : newSeasonPending
                      ? null
                      : `First meeting with ${next.opponent} this season`
                }
                lastSeasonLine={
                  lastSeason
                    ? `${formatSeasonLabel(lastSeason.seasonId)}: ${lastSeason.wins}-${lastSeason.losses}-${lastSeason.otl}, ${lastSeason.points} pts · ${
                        lastSeason.lastSeries
                          ? `${lastSeason.lastSeries.won ? "won" : "lost"} the ${roundLabel(lastSeason.lastSeries.round)} ${lastSeason.lastSeries.won ? "vs" : "to"} ${lastSeason.lastSeries.opp_abbrev}, ${lastSeason.lastSeries.teamWins}-${lastSeason.lastSeries.oppWins}`
                          : "missed the playoffs"
                      }`
                    : null
                }
                lastGame={lastGame && daysSinceLast < 3 ? lastGame : null}
              />
            )}
            {hero === "pending" && pending && <PendingHero game={pending} teamName={teamName} abbrev={abbrev} titleSize={titleSize} />}
            {hero === "recap" && lastGame && <RecapHero game={lastGame} abbrev={abbrev} titleSize={titleSize} compact={compact} />}
          </div>
        </section>
      )}

      {/* STAT STRIP */}
      {standings && ownStanding && (
        <section style={{ margin: "2.25rem 0 2.5rem" }}>
          {seasonCaption && <div style={{ ...CAPTION, marginBottom: 10 }}>{seasonCaption}</div>}
          <div className="stat-strip">
            <div style={{ padding: "1.5rem 1.75rem" }}>
              <div style={TILE_LABEL}>Record</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "2.4rem" }}>
                {ownStanding.wins}-{ownStanding.losses}-{ownStanding.ot_losses}
              </div>
            </div>
            <div style={{ padding: "1.5rem 1.75rem" }}>
              <div style={TILE_LABEL}>Points</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "2.4rem" }}>
                {ownStanding.points}{" "}
                <span style={{ fontSize: "1.2rem", color: "var(--gold)" }}>
                  {ownStanding.division_rank === 1 ? "1st" : `#${ownStanding.division_rank}`}, {standings.division}
                </span>
              </div>
            </div>
            <StreakTile form={form} abbrev={abbrev} />
            {hero === "preview" || !next ? (
              <div style={{ padding: "1.5rem 1.75rem" }}>
                <div style={TILE_LABEL}>Goal Diff</div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: "2.4rem" }}>
                  {standings.goalDiff > 0 ? `+${standings.goalDiff}` : standings.goalDiff}
                </div>
                <div style={{ ...CAPTION, marginTop: 2 }}>
                  {standings.goalsFor} for, {standings.goalsAgainst} against
                </div>
              </div>
            ) : (
              <div style={{ padding: "1.5rem 1.75rem" }}>
                <div style={TILE_LABEL}>Next Up</div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: "2.4rem" }}>
                  {next.isHome ? "vs" : "@"} {next.opponent}
                </div>
                <div style={{ fontSize: ".85rem", color: "var(--text-secondary)", marginTop: 2 }}>
                  {formatStartTimeET(next.startTimeUTC)}
                  {next.tv.length > 0 && ` · ${next.tv.join(", ")}`}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {moves && <RosterMovesCard teamAbbrev={abbrev} moves={moves} captainName={captainName} />}

      {!compact && <AskBand />}

      {/* RECENT RESULTS */}
      {recent.length > 0 && (
        <section style={{ marginBottom: "2.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "1rem", gap: 12, flexWrap: "wrap" }}>
            <h2 style={H2}>
              Recent Results
              {newSeasonPending && seasonLabel && <span style={{ ...CAPTION, marginLeft: 10, textTransform: "none", fontFamily: "var(--font-body)", letterSpacing: 0 }}>{seasonLabel}</span>}
            </h2>
            {abbrev === "BOS" && (
              <Link href="/schedule" style={{ fontSize: ".82rem", fontWeight: 600, color: "var(--gold)", textDecoration: "none" }}>
                Full schedule →
              </Link>
            )}
          </div>
          <div className="card-row">
            {recent.map((c) => (c.kind === "series" ? <SeriesCard key={`s${c.seriesId}`} card={c} abbrev={abbrev} /> : <GameCard key={c.id} card={c} abbrev={abbrev} />))}
          </div>
        </section>
      )}

      {milestones.length > 0 && (
        <section style={{ marginBottom: "2.5rem" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: "1rem" }}>
            <h2 style={H2}>Milestone Watch</h2>
            <span style={CAPTION}>Career, regular season</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {milestones.slice(0, 4).map((m) => (
              <Link
                key={`${m.playerId}-${m.category}`}
                href={`/players/${m.playerId}`}
                style={{
                  background: "var(--surface-1)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "12px 18px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  textDecoration: "none",
                  color: "var(--text-primary)",
                  fontSize: ".9rem",
                }}
              >
                <span>
                  <strong>{m.playerName}</strong> {milestoneText(m)}
                </span>
                <span style={{ color: "var(--gold)", fontWeight: 700, fontFamily: "var(--font-display)", fontSize: "1.1rem", whiteSpace: "nowrap" }}>
                  {m.current}/{m.target}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {homeRoadSplit && (homeRoadSplit.home.games > 0 || homeRoadSplit.away.games > 0) && (
        <section style={{ marginBottom: "2.5rem" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: "1rem" }}>
            <h2 style={H2}>Home / Road</h2>
            {seasonCaption && <span style={CAPTION}>{seasonCaption}</span>}
          </div>
          <div className="card-row">
            {(["home", "away"] as const).map((side) => (
              <div key={side} style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 10, padding: "1.1rem 1.2rem" }}>
                <div style={{ fontSize: ".72rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: ".4rem" }}>
                  {side === "home" ? "At Home" : "On the Road"}
                </div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "2rem", color: "var(--gold)", fontVariantNumeric: "tabular-nums" }}>
                  {homeRoadSplit[side].wins}-{homeRoadSplit[side].losses}-{homeRoadSplit[side].otl}
                </div>
                <div style={{ fontSize: ".78rem", color: "var(--text-secondary)", marginTop: 4 }}>
                  {homeRoadSplit[side].points} pts in {homeRoadSplit[side].games} games
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* STANDINGS + STAT LEADERS */}
      <div className="homepage-lower-grid">
        {standings && (
          <section>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: "1rem" }}>
              <h2 style={H2}>{standings.division}</h2>
              <Link href="/standings" style={{ fontSize: ".82rem", fontWeight: 600, color: "var(--gold)", textDecoration: "none" }}>
                {seasonLabel && `${seasonLabel}${newSeasonPending || regularSeasonDone ? " final" : ""} · `}Full standings →
              </Link>
            </div>
            <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
              <div className="standings-row standings-row--compact" style={{ padding: "10px 18px", fontSize: ".68rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", borderBottom: "1px solid var(--border)" }}>
                <span>#</span>
                <span>Team</span>
                <span>W</span>
                <span>L</span>
                <span className="standings-col-otl">OTL</span>
                <span>PTS</span>
              </div>
              {standings.teams.map((t) => {
                const own = t.abbrev === abbrev;
                return (
                  <Link
                    key={t.abbrev}
                    href={`/teams/${t.abbrev}`}
                    className="standings-row standings-row--compact"
                    style={{
                      padding: "12px 18px",
                      alignItems: "center",
                      fontSize: ".88rem",
                      borderTop: "1px solid var(--border)",
                      textDecoration: "none",
                      background: own ? "rgba(255,184,28,0.08)" : "transparent",
                      borderLeft: own ? "3px solid var(--gold)" : "3px solid transparent",
                      color: own ? "var(--text-primary)" : "var(--text-secondary)",
                      fontWeight: own ? 700 : 400,
                    }}
                  >
                    <span style={{ color: own ? "var(--gold)" : "inherit" }}>{t.division_rank}</span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 8 }}>{t.name}</span>
                    <span>{t.wins}</span>
                    <span>{t.losses}</span>
                    <span className="standings-col-otl">{t.ot_losses}</span>
                    <span style={{ color: own ? "var(--gold)" : "inherit" }}>{t.points}</span>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {statLeaders && <StatLeaders statLeaders={statLeaders} caption={seasonCaption ?? undefined} />}
      </div>
    </>
  );
}

function PreviewHero({
  game,
  tag,
  when,
  teamName,
  abbrev,
  titleSize,
  h2hLine,
  lastSeasonLine,
  lastGame,
}: {
  game: ClubGame;
  tag: string;
  when: string;
  teamName: string;
  abbrev: string;
  titleSize: string;
  h2hLine: string | null;
  lastSeasonLine: string | null;
  lastGame: { id: number; game_date: Date; home_abbrev: string; home_score: number; away_score: number; game_end_type: string } | null;
}) {
  const flavor = nextGameFlavor(game, abbrev);
  const lastIsHome = lastGame?.home_abbrev === abbrev;
  return (
    <>
      <div style={{ maxWidth: 680 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: ".75rem" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--gold)", display: "inline-block" }} />
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--gold)", fontSize: ".95rem" }}>
            {tag}
            {tag !== when && ` · ${when}`}
          </span>
        </div>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: titleSize, lineHeight: 0.94, letterSpacing: ".01em", textTransform: "uppercase", margin: "0 0 1rem" }}>
          {teamName} {game.isHome ? "vs" : "at"} {game.opponentName}
        </h1>
        <p style={{ fontSize: "1rem", color: "var(--text-primary)", margin: "0 0 .9rem" }}>
          {formatStartTimeET(game.startTimeUTC)} · {game.venue}
          {game.tv.length > 0 && <> · <span style={{ color: "var(--gold)", fontWeight: 600 }}>{game.tv.join(", ")}</span></>}
        </p>
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1.5rem", display: "grid", gap: 4, fontSize: ".92rem", color: "var(--text-secondary)" }}>
          {lastSeasonLine && <li>{lastSeasonLine}</li>}
          {h2hLine && <li>{h2hLine}</li>}
          {flavor && <li style={{ fontFamily: "var(--font-editorial)", fontStyle: "italic" }}>{flavor}</li>}
        </ul>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {abbrev === "BOS" && (
            <Link href="/schedule" style={{ background: "var(--gold)", color: "var(--ink)", fontWeight: 700, fontSize: ".9rem", padding: "13px 24px", borderRadius: 8, textDecoration: "none" }}>
              Full schedule
            </Link>
          )}
          {lastGame && (
            <Link
              href={`/games/${lastGame.id}`}
              style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: ".9rem", padding: "13px 20px", borderRadius: 8, border: "1px solid var(--border)", textDecoration: "none" }}
            >
              Last game: {resultLabel(lastIsHome ? lastGame.home_score : lastGame.away_score, lastIsHome ? lastGame.away_score : lastGame.home_score, lastGame.game_end_type)}{" "}
              {lastIsHome ? lastGame.home_score : lastGame.away_score}-{lastIsHome ? lastGame.away_score : lastGame.home_score} →
            </Link>
          )}
        </div>
      </div>
      {/* Repeats the time above, so it's desktop-only (hidden on phones). */}
      <div className="hero-aside" style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 16, padding: "1.5rem 1.9rem", minWidth: 240 }}>
        <div style={{ ...TILE_LABEL, marginBottom: 4 }}>Puck drop</div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: "2.8rem", lineHeight: 1 }}>{formatStartTimeET(game.startTimeUTC, false).replace(" ET", "")}</div>
        <div style={{ ...CAPTION, marginTop: 6 }}>
          Eastern · {game.isHome ? "Home" : "Away"}
        </div>
      </div>
    </>
  );
}

function PendingHero({ game, teamName, abbrev, titleSize }: { game: ClubGame; teamName: string; abbrev: string; titleSize: string }) {
  const live = isInProgress(game);
  const hasScore = game.teamScore != null && game.oppScore != null;
  const won = hasScore && game.teamScore! > game.oppScore!;
  return (
    <>
      <div style={{ maxWidth: 680 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: ".75rem" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: live ? "var(--loss)" : "var(--win)", display: "inline-block" }} />
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-secondary)", fontSize: ".95rem" }}>
            {live ? "In progress" : `Final${game.endType === "overtime" ? " (OT)" : game.endType === "shootout" ? " (SO)" : ""}`} · {formatGameDate(game.gameDate, true)}
          </span>
        </div>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: titleSize, lineHeight: 0.94, letterSpacing: ".01em", textTransform: "uppercase", margin: "0 0 1rem" }}>
          {teamName} {game.isHome ? "vs" : "at"} {game.opponentName}
        </h1>
        <p style={{ fontSize: ".95rem", color: "var(--text-secondary)", margin: "0 0 1.4rem", maxWidth: 560 }}>
          {live
            ? "Score updates every few minutes here. Full box score and recap land after the final horn."
            : "The full box score and recap land here within about an hour of the final horn, once the NHL posts the official stats."}
        </p>
        <a
          href={`https://www.nhl.com/gamecenter/${game.id}`}
          style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: ".9rem", padding: "13px 20px", borderRadius: 8, border: "1px solid var(--border)", textDecoration: "none" }}
        >
          NHL.com game center ↗
        </a>
      </div>
      {hasScore && (
        <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 16, padding: "1.6rem 2rem", minWidth: 240 }}>
          <ScoreLine label={abbrev} score={game.teamScore!} strong={!live && won} />
          <div style={{ height: 1, background: "var(--border)", margin: ".8rem 0" }} />
          <ScoreLine label={game.opponent} score={game.oppScore!} strong={!live && !won} muted />
        </div>
      )}
    </>
  );
}

function RecapHero({
  game,
  abbrev,
  titleSize,
  compact,
}: {
  game: { id: number; game_date: Date; game_type: string; home_abbrev: string; away_abbrev: string; home_score: number; away_score: number; game_end_type: string; headline: string | null; body: string | null };
  abbrev: string;
  titleSize: string;
  compact: boolean;
}) {
  const isHome = game.home_abbrev === abbrev;
  const own = isHome ? game.home_score : game.away_score;
  const opp = isHome ? game.away_score : game.home_score;
  const oppAbbrev = isHome ? game.away_abbrev : game.home_abbrev;
  const won = own > opp;
  return (
    <>
      <div style={{ maxWidth: 680 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: ".75rem" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--win)", display: "inline-block" }} />
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-secondary)", fontSize: ".9rem" }}>
            {game.game_type === "playoff" ? "Playoff — Final" : "Final"} · {formatGameDate(game.game_date, true)}
          </span>
        </div>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: titleSize, lineHeight: 0.94, letterSpacing: ".01em", textTransform: "uppercase", margin: "0 0 1.1rem" }}>
          <Link href={`/games/${game.id}`} style={{ color: "inherit", textDecoration: "none" }}>
            {game.headline ?? `${abbrev} ${won ? "beat" : "fall to"} ${oppAbbrev}, ${own}-${opp}`}
          </Link>
        </h1>
        {game.body && (
          <p style={{ fontFamily: "var(--font-editorial)", fontStyle: "italic", fontSize: compact ? "1.05rem" : "1.2rem", color: "var(--text-secondary)", maxWidth: 600, lineHeight: 1.5, margin: "0 0 1.6rem" }}>
            &ldquo;{game.body}&rdquo;
          </p>
        )}
        <Link href={`/games/${game.id}`} style={{ background: "var(--gold)", color: "var(--ink)", fontWeight: 700, fontSize: ".9rem", padding: "13px 24px", borderRadius: 8, textDecoration: "none" }}>
          Box score &amp; recap
        </Link>
      </div>
      <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 16, padding: "1.6rem 2rem", minWidth: 240 }}>
        <ScoreLine label={abbrev} score={own} strong={won} />
        <div style={{ height: 1, background: "var(--border)", margin: ".8rem 0" }} />
        <ScoreLine label={oppAbbrev} score={opp} strong={!won} muted />
      </div>
    </>
  );
}

function ScoreLine({ label, score, strong, muted = false }: { label: string; score: number; strong: boolean; muted?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 24 }}>
      <span style={{ fontWeight: 700, fontSize: ".95rem", color: muted ? "var(--text-secondary)" : "var(--text-primary)" }}>{label}</span>
      <span style={{ fontFamily: "var(--font-display)", fontSize: "2.6rem", lineHeight: 1, color: strong ? "var(--gold)" : "var(--text-secondary)" }}>{score}</span>
    </div>
  );
}

function StreakTile({ form, abbrev }: { form: FormResult[]; abbrev: string }) {
  const last = form[form.length - 1];
  let n = 0;
  for (let i = form.length - 1; i >= 0 && form[i] === last; i--) n++;
  return (
    <div style={{ padding: "1.5rem 1.75rem" }}>
      <div style={TILE_LABEL}>Streak</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: "2.4rem" }}>
        {last ? `${last}${n}` : "—"}
        {abbrev === "BOS" && last === "W" && n >= 3 && (
          <span style={{ fontSize: "1.1rem", fontFamily: "var(--font-body)", color: "var(--text-secondary)", marginLeft: 8 }}>stop us</span>
        )}
      </div>
      {form.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <FormBars results={form} />
        </div>
      )}
    </div>
  );
}

function GameCard({ card, abbrev }: { card: Extract<RecentCard, { kind: "game" }>; abbrev: string }) {
  const won = card.team_score > card.opp_score;
  return (
    <Link href={`/games/${card.id}`} style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 10, padding: "1rem 1.2rem", textDecoration: "none", color: "inherit" }}>
      <div style={{ fontSize: ".72rem", fontWeight: 600, textTransform: "uppercase", marginBottom: 10, display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span style={{ color: "var(--text-secondary)" }}>{formatGameDate(card.game_date)}</span>
        <span style={{ color: won ? "var(--win)" : "var(--loss)" }}>{resultLabel(card.team_score, card.opp_score, card.game_end_type)}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: ".88rem", fontWeight: 700 }}>{abbrev}</span>
        <span style={{ fontSize: ".88rem", fontWeight: 700, color: won ? "var(--gold)" : "var(--text-secondary)" }}>{card.team_score}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: ".88rem", color: "var(--text-secondary)" }}>
          {card.is_home ? "vs" : "@"} {card.opp_abbrev}
        </span>
        <span style={{ fontSize: ".88rem", color: "var(--text-secondary)" }}>{card.opp_score}</span>
      </div>
    </Link>
  );
}

function SeriesCard({ card, abbrev }: { card: Extract<RecentCard, { kind: "series" }>; abbrev: string }) {
  // Always this team's wins first, matching the Playoffs tab ("Lost 2-4").
  const status = card.decided
    ? `${card.won ? "Won" : "Lost"} ${card.teamWins}-${card.oppWins}`
    : card.teamWins === card.oppWins
      ? `Tied ${card.teamWins}-${card.oppWins}`
      : `${card.teamWins > card.oppWins ? "Leads" : "Trails"} ${card.teamWins}-${card.oppWins}`;
  const good = card.decided ? card.won : card.teamWins >= card.oppWins;
  return (
    <Link
      href={`/games/${card.latestGameId}`}
      className="card-wide"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 10, padding: "1rem 1.2rem", textDecoration: "none", color: "inherit" }}
    >
      <div style={{ fontSize: ".72rem", fontWeight: 600, textTransform: "uppercase", marginBottom: 10, display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span style={{ color: "var(--text-secondary)" }}>Playoffs · {roundLabel(card.round)}</span>
        <span style={{ color: good ? "var(--win)" : "var(--loss)" }}>{status}</span>
      </div>
      <div style={{ fontSize: ".95rem", fontWeight: 700, marginBottom: 10 }}>
        {abbrev} vs {card.opp_abbrev}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {card.games.map((g, i) => {
          const w = g.team_score > g.opp_score;
          return (
            <span
              key={g.id}
              style={{
                fontSize: ".72rem",
                padding: "3px 7px",
                borderRadius: 6,
                border: `1px solid ${w ? "rgba(255,184,28,0.4)" : "var(--border)"}`,
                color: w ? "var(--gold)" : "var(--text-secondary)",
              }}
            >
              G{i + 1} {g.team_score}-{g.opp_score}
            </span>
          );
        })}
      </div>
    </Link>
  );
}

function AskBand() {
  return (
    <section
      style={{
        margin: "0 0 2.5rem",
        padding: "2rem 2.2rem",
        borderRadius: 16,
        background: "linear-gradient(135deg, var(--surface-1) 0%, var(--surface-2) 100%)",
        border: "1px solid rgba(255,184,28,0.22)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 24,
        flexWrap: "wrap",
      }}
    >
      <div style={{ maxWidth: 460 }}>
        <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--gold)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8 }}>Ask Causeway</div>
        <h2 style={{ margin: "0 0 6px", fontSize: "1.4rem", fontFamily: "var(--font-body)", fontWeight: 700 }}>Got a stat question? Just ask.</h2>
        {/* Scope stated plainly: the database starts in 2007-08. It once
            said "Full NHL history", which the answers themselves contradict. */}
        <p style={{ margin: 0, fontSize: ".9rem", color: "var(--text-secondary)" }}>Every NHL game since 2007-08, every team, straight from the database. Every answer shows its work.</p>
      </div>
      <Link
        href="/ask"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--ink)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "14px 20px",
          fontSize: ".9rem",
          color: "var(--text-secondary)",
          textDecoration: "none",
          flex: "1 1 260px",
          maxWidth: 420,
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2.4" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        e.g. &ldquo;Longest point streak by a Bruins player?&rdquo;
      </Link>
    </section>
  );
}
