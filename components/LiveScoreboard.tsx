"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { trackGoals, startTracking, boardGoals, finalAndComplete, type GoalTracker, type LiveGame, type LiveGoal } from "@/lib/live-game";
import type { LiveWp } from "@/lib/live-wp";
import type { WpTimeline } from "@/lib/wp-game";
import { WinProbChart } from "@/components/WinProbChart";
import { goalWpaFromCurve, formatWpa } from "@/lib/wp-curve";

const POLL_MS = 20_000;
const WINDOW_BEFORE_MS = 15 * 60_000; // start polling 15 min before puck drop
const WINDOW_AFTER_MS = 6 * 3600_000; // give up 6h after (a long OT game is ~3.5h)
const FINAL_GRACE_MS = 15 * 60_000; // after the final, wait at most this long for a goal the feed dropped

const isLive = (g: LiveGame) => g.state === "LIVE" || g.state === "CRIT";
// OVER (horn gone, result not yet official) shows as final; polling still
// waits for FINAL with every goal on the board (finalAndComplete).
const isFinal = (g: LiveGame) => g.state === "FINAL" || g.state === "OFF" || g.state === "OVER";

// A live score card that keeps itself current while a game is on: score,
// shots, period and clock, power play, and each goal as it's scored. Shows
// `children` (the server-rendered preview or score) until the game starts,
// and outside the game window it never fetches at all. Polling pauses
// while the tab is hidden.
//
// Goal light: a goal that appears while the page is open flashes the card
// red (about once a second, well under the 3-per-second photosensitivity
// limit) and drops in a banner with the scorer. Only focusTeam's goals
// when it's playing; either team's otherwise. Goals already on the board
// when the page opens never trigger it. A goal that vanishes from the feed
// (overturned on review) shows a note instead.
export function LiveScoreboard({
  gameId,
  startTimeUTC,
  title,
  variant,
  focusTeam = "BOS",
  children,
}: {
  gameId: number;
  startTimeUTC: string;
  title: string; // "Bruins vs Rangers"
  variant: "hero" | "page";
  focusTeam?: string;
  children?: ReactNode;
}) {
  const [game, setGame] = useState<LiveGame | null>(null);
  // Win probability (home side) from /api/live. The curve is kept from the
  // last poll whose goal list added up to the score, so a feed flicker
  // doesn't blank the chart; `now` always follows the scoreboard.
  const [wpNow, setWpNow] = useState<number | null>(null);
  const [wpCurve, setWpCurve] = useState<WpTimeline | null>(null);
  const [stale, setStale] = useState(false);
  const [celebration, setCelebration] = useState<{ id: number; goal: LiveGoal } | null>(null);
  const [overturned, setOverturned] = useState<{ id: number; goal: LiveGoal } | null>(null);
  const done = useRef(false);
  const seenGoals = useRef<GoalTracker | null>(null);
  const finalSince = useRef<number | null>(null);

  // Each celebration or note clears itself after a few seconds.
  useEffect(() => {
    if (!celebration) return;
    const t = setTimeout(() => setCelebration(null), 7000);
    return () => clearTimeout(t);
  }, [celebration]);
  useEffect(() => {
    if (!overturned) return;
    const t = setTimeout(() => setOverturned(null), 30000);
    return () => clearTimeout(t);
  }, [overturned]);

  useEffect(() => {
    const start = Date.parse(startTimeUTC);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const tick = async () => {
      const now = Date.now();
      const inWindow = now >= start - WINDOW_BEFORE_MS && now <= start + WINDOW_AFTER_MS;
      if (inWindow && !done.current && document.visibilityState === "visible") {
        try {
          const res = await fetch(`/api/live/${gameId}`, { cache: "no-store" });
          if (res.ok) {
            const { wp, ...g }: LiveGame & { wp?: LiveWp | null } = await res.json();
            if (cancelled) return;
            setWpNow(wp?.now ?? null);
            if (wp?.timeline) setWpCurve(wp.timeline);
            // The first response is the baseline: goals already scored
            // when the page opened never light up.
            if (seenGoals.current) {
              const { state, added, removed, restored } = trackGoals(seenGoals.current, g);
              seenGoals.current = state;
              // A goal back on the board after an "overturn" was a feed
              // blip: drop the note, no second goal light.
              if (restored.length) setOverturned(null);
              const playing = g.home.abbrev === focusTeam || g.away.abbrev === focusTeam;
              const cheer = added.filter((x) => !playing || x.team === focusTeam).at(-1);
              if (cheer) setCelebration({ id: Date.now(), goal: cheer });
              if (removed.length) setOverturned({ id: Date.now(), goal: removed.at(-1)! });
            } else {
              seenGoals.current = startTracking(g);
            }
            setGame({ ...g, goals: boardGoals(seenGoals.current) });
            setStale(false);
            // Stop once final with every goal on the board; if the feed stays
            // short a goal, give it 15 minutes past the final, then stop.
            if (isFinal(g)) finalSince.current ??= Date.now();
            if (finalAndComplete(g, seenGoals.current) || (finalSince.current && Date.now() - finalSince.current > FINAL_GRACE_MS)) done.current = true;
          } else if (!cancelled) {
            setStale(true);
          }
        } catch {
          if (!cancelled) setStale(true);
        }
      }
      // Outside the window, check back each minute (no request) in case
      // the page was opened early and left open until puck drop.
      if (!cancelled && !done.current) timer = setTimeout(tick, inWindow ? POLL_MS : 60_000);
    };
    tick();
    const onVisible = () => {
      if (document.visibilityState === "visible" && !done.current) {
        clearTimeout(timer);
        tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [gameId, startTimeUTC, focusTeam]);

  if (!game || !(isLive(game) || isFinal(game))) return <>{children}</>;
  const extras = { celebration, overturned };
  // From the focus team's side when it's playing, else the home team's.
  const sideHome = game.away.abbrev !== focusTeam;
  const wp = { now: wpNow, curve: wpCurve, sideHome };
  return variant === "hero" ? <HeroBoard g={game} title={title} stale={stale} wp={wp} {...extras} /> : <PageBoard g={game} stale={stale} wp={wp} {...extras} />;
}

type Extras = { celebration: { id: number; goal: LiveGoal } | null; overturned: { id: number; goal: LiveGoal } | null };
type WpView = { now: number | null; curve: WpTimeline | null; sideHome: boolean };

const wpPct = (p: number) => (p > 0 && p < 0.01 ? "<1%" : p < 1 && p > 0.99 ? ">99%" : `${Math.round(100 * p)}%`);

// One line under the score: each team's chance to win right now.
function WinChanceBar({ g, wp }: { g: LiveGame; wp: WpView }) {
  if (wp.now == null) return null;
  const home = wp.now;
  const [left, right] = wp.sideHome ? [g.home, g.away] : [g.away, g.home];
  const pl = wp.sideHome ? home : 1 - home;
  return (
    <div style={{ marginTop: ".9rem" }} aria-label={`Chance to win: ${left.abbrev} ${wpPct(pl)}, ${right.abbrev} ${wpPct(1 - pl)}`}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".75rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>
        <span>
          <span style={{ color: "var(--gold)" }}>{left.abbrev} {wpPct(pl)}</span> chance to win
        </span>
        <span>
          {right.abbrev} {wpPct(1 - pl)}
        </span>
      </div>
      <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", background: "var(--border)" }}>
        <span style={{ width: `${100 * pl}%`, background: "var(--gold)", transition: "width .8s ease" }} />
      </div>
    </div>
  );
}

// The red flash and the scorer banner, layered over the score card.
function GoalLight({ celebration }: Pick<Extras, "celebration">) {
  if (!celebration) return null;
  const { goal } = celebration;
  return (
    <>
      <span key={`light-${celebration.id}`} className="goal-light" aria-hidden="true" />
      <div key={`banner-${celebration.id}`} className="goal-banner" role="status">
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: ".08em" }}>{goal.team} GOAL</span>
        <span style={{ fontWeight: 600 }}>
          {goal.scorer}
          {goal.scorerGoals != null ? ` (${goal.scorerGoals})` : ""}
        </span>
      </div>
    </>
  );
}

function OverturnedNote({ overturned }: Pick<Extras, "overturned">) {
  if (!overturned) return null;
  return (
    <p role="status" style={{ margin: "8px 0 0", fontSize: ".8rem", color: "var(--text-secondary)" }}>
      Goal overturned: {overturned.goal.team} {overturned.goal.period} {overturned.goal.time} ({overturned.goal.scorer}) is off the board.
    </p>
  );
}

function StatusLine({ g, stale }: { g: LiveGame; stale: boolean }) {
  const live = isLive(g);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span className={live ? "live-dot" : undefined} style={{ width: 8, height: 8, borderRadius: "50%", background: live ? "var(--loss)" : "var(--win)", display: "inline-block" }} />
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: live ? "var(--text-primary)" : "var(--text-secondary)", fontSize: ".95rem" }}>
        {live ? "Live · " : ""}
        {g.status}
      </span>
      {g.situation && (
        <span style={{ fontSize: ".75rem", fontWeight: 700, color: "var(--ink)", background: "var(--gold)", borderRadius: 4, padding: "1px 7px" }}>{g.situation}</span>
      )}
      {stale && <span style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>reconnecting…</span>}
    </div>
  );
}

function ScoreRow({ t, leading, big }: { t: LiveGame["home"]; leading: boolean; big: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16 }}>
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: big ? "1.6rem" : "1.2rem", letterSpacing: ".02em", color: leading ? "var(--text-primary)" : "var(--text-secondary)" }}>
        {t.abbrev}
        {t.sog != null && <span style={{ fontFamily: "var(--font-body)", fontSize: ".75rem", fontWeight: 400, color: "var(--text-muted)", marginLeft: 8 }}>{t.sog} SOG</span>}
      </span>
      <span style={{ fontFamily: "var(--font-display)", fontSize: big ? "3rem" : "2.2rem", lineHeight: 1, fontVariantNumeric: "tabular-nums", color: leading ? "var(--text-primary)" : "var(--text-secondary)" }}>{t.score}</span>
    </div>
  );
}

function Scores({ g, big }: { g: LiveGame; big: boolean }) {
  return (
    <>
      <ScoreRow t={g.away} leading={g.away.score > g.home.score} big={big} />
      <div style={{ height: 1, background: "var(--border)", margin: ".7rem 0" }} />
      <ScoreRow t={g.home} leading={g.home.score > g.away.score} big={big} />
    </>
  );
}

// Each goal's win chance added, once the curve includes it (the curve
// comes with the poll that first shows the goal, so the badge lands with it).
function GoalList({ g, limit, wp }: { g: LiveGame; limit?: number; wp: WpView }) {
  const goals = [...g.goals].reverse().slice(0, limit);
  const wpa = wp.curve ? goalWpaFromCurve(wp.curve.points) : null;
  if (goals.length === 0) return <p style={{ fontSize: ".85rem", color: "var(--text-muted)", margin: 0 }}>No goals yet.</p>;
  return (
    <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {goals.map((goal, i) => (
        <li key={`${goal.period}-${goal.time}-${i}`} style={{ display: "grid", gridTemplateColumns: "4.2rem 1fr", gap: 10, padding: "7px 0", borderTop: i ? "1px solid var(--border)" : "none", fontSize: ".85rem" }}>
          <span style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
            {goal.period} {goal.time}
          </span>
          <span>
            <span style={{ fontWeight: 700, color: "var(--gold)", marginRight: 6 }}>{goal.team}</span>
            <span style={{ fontWeight: 600 }}>{goal.scorer}</span>
            {goal.scorerGoals != null && <span style={{ color: "var(--text-secondary)" }}> ({goal.scorerGoals})</span>}
            {(goal.strength || goal.emptyNet) && (
              <span style={{ fontSize: ".7rem", fontWeight: 700, color: "var(--text-secondary)", border: "1px solid var(--border)", borderRadius: 4, padding: "0 5px", marginLeft: 6 }}>
                {[goal.strength, goal.emptyNet ? "EN" : null].filter(Boolean).join(" · ")}
              </span>
            )}
            <span style={{ display: "block", color: "var(--text-secondary)", fontSize: ".78rem" }}>
              {goal.assists.length ? `from ${goal.assists.join(", ")}` : "unassisted"} · {g.away.abbrev} {goal.awayScore}, {g.home.abbrev} {goal.homeScore}
            </span>
            {goal.eventId != null && wpa?.has(goal.eventId) && <span className="wpa-badge">{formatWpa(wpa.get(goal.eventId)!.wpa)} win chance for {goal.team}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function HeroBoard({ g, title, stale, wp, celebration, overturned }: { g: LiveGame; title: string; stale: boolean; wp: WpView } & Extras) {
  const final = isFinal(g);
  return (
    <>
      <div style={{ maxWidth: 680, flex: "1 1 320px" }}>
        <div style={{ marginBottom: ".75rem" }}>
          <StatusLine g={g} stale={stale} />
        </div>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.2rem,5vw,3.6rem)", lineHeight: 0.94, letterSpacing: ".01em", textTransform: "uppercase", margin: "0 0 1rem" }}>{title}</h1>
        <div style={{ position: "relative", overflow: "hidden", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 16, padding: "1.2rem 1.5rem", maxWidth: 420, marginBottom: "1.2rem" }}>
          <GoalLight celebration={celebration} />
          <Scores g={g} big />
          <WinChanceBar g={g} wp={wp} />
        </div>
        <OverturnedNote overturned={overturned} />
        <p style={{ fontSize: ".85rem", color: "var(--text-secondary)", margin: "0 0 1.2rem" }}>
          {final ? "The full box score and recap land here within about an hour, once the NHL posts the official stats." : "Updates on its own every 20 seconds."}
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link href={`/games/${g.id}`} style={{ background: "var(--gold)", color: "var(--ink)", fontWeight: 700, fontSize: ".9rem", padding: "13px 24px", borderRadius: 8, textDecoration: "none" }}>
            Game page
          </Link>
          <a href={`https://www.nhl.com/gamecenter/${g.id}`} style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: ".9rem", padding: "13px 20px", borderRadius: 8, border: "1px solid var(--border)", textDecoration: "none" }}>
            NHL.com game center ↗
          </a>
        </div>
      </div>
      <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 16, padding: "1.2rem 1.5rem", flex: "1 1 300px", maxWidth: 440 }}>
        <div style={{ fontSize: ".72rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>Scoring</div>
        <GoalList g={g} limit={6} wp={wp} />
      </div>
    </>
  );
}

function PageBoard({ g, stale, wp, celebration, overturned }: { g: LiveGame; stale: boolean; wp: WpView } & Extras) {
  return (
    <>
    <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", marginTop: "1.2rem" }}>
      <div style={{ position: "relative", overflow: "hidden", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.1rem 1.3rem" }}>
        <GoalLight celebration={celebration} />
        <div style={{ marginBottom: ".8rem" }}>
          <StatusLine g={g} stale={stale} />
        </div>
        <Scores g={g} big={false} />
        <WinChanceBar g={g} wp={wp} />
        <OverturnedNote overturned={overturned} />
      </div>
      <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.1rem 1.3rem" }}>
        <div style={{ fontSize: ".72rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>Scoring</div>
        <GoalList g={g} wp={wp} />
      </div>
    </div>
    {wp.curve && (
      <div style={{ marginTop: "1.75rem" }}>
        <WinProbChart tl={wp.curve} sideHome={wp.sideHome} />
      </div>
    )}
    </>
  );
}
