"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LiveGame } from "@/lib/live-game";

const POLL_MS = 20_000;
const WINDOW_BEFORE_MS = 15 * 60_000; // start polling 15 min before puck drop
const WINDOW_AFTER_MS = 6 * 3600_000; // give up 6h after (a long OT game is ~3.5h)

const isLive = (g: LiveGame) => g.state === "LIVE" || g.state === "CRIT";
const isFinal = (g: LiveGame) => g.state === "FINAL" || g.state === "OFF";

// A live score card that keeps itself current while a game is on: score,
// shots, period and clock, power play, and each goal as it's scored. Shows
// `children` (the server-rendered preview or score) until the game starts,
// and outside the game window it never fetches at all. Polling pauses
// while the tab is hidden.
export function LiveScoreboard({
  gameId,
  startTimeUTC,
  title,
  variant,
  children,
}: {
  gameId: number;
  startTimeUTC: string;
  title: string; // "Bruins vs Rangers"
  variant: "hero" | "page";
  children?: ReactNode;
}) {
  const [game, setGame] = useState<LiveGame | null>(null);
  const [stale, setStale] = useState(false);
  const done = useRef(false);

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
            const g: LiveGame = await res.json();
            if (cancelled) return;
            setGame(g);
            setStale(false);
            if (isFinal(g)) done.current = true;
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
  }, [gameId, startTimeUTC]);

  if (!game || !(isLive(game) || isFinal(game))) return <>{children}</>;
  return variant === "hero" ? <HeroBoard g={game} title={title} stale={stale} /> : <PageBoard g={game} stale={stale} />;
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

function GoalList({ g, limit }: { g: LiveGame; limit?: number }) {
  const goals = [...g.goals].reverse().slice(0, limit);
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
          </span>
        </li>
      ))}
    </ol>
  );
}

function HeroBoard({ g, title, stale }: { g: LiveGame; title: string; stale: boolean }) {
  const final = isFinal(g);
  return (
    <>
      <div style={{ maxWidth: 680, flex: "1 1 320px" }}>
        <div style={{ marginBottom: ".75rem" }}>
          <StatusLine g={g} stale={stale} />
        </div>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.2rem,5vw,3.6rem)", lineHeight: 0.94, letterSpacing: ".01em", textTransform: "uppercase", margin: "0 0 1rem" }}>{title}</h1>
        <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 16, padding: "1.2rem 1.5rem", maxWidth: 420, marginBottom: "1.2rem" }}>
          <Scores g={g} big />
        </div>
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
        <GoalList g={g} limit={6} />
      </div>
    </>
  );
}

function PageBoard({ g, stale }: { g: LiveGame; stale: boolean }) {
  return (
    <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", marginTop: "1.2rem" }}>
      <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.1rem 1.3rem" }}>
        <div style={{ marginBottom: ".8rem" }}>
          <StatusLine g={g} stale={stale} />
        </div>
        <Scores g={g} big={false} />
      </div>
      <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.1rem 1.3rem" }}>
        <div style={{ fontSize: ".72rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>Scoring</div>
        <GoalList g={g} />
      </div>
    </div>
  );
}
