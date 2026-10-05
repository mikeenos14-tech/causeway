"use client";

import { useEffect, useState } from "react";
import { ChancesCard, type ChancesData } from "./Chances";

// The chances card during a game: refreshed every 15 s while the page is
// on screen (the endpoint's edge cache is 15 s too), "deserved to win" once
// the NHL calls the game final.
export function ChancesLive({ gameId, homeAbbrev, awayAbbrev, sideHome, active }: { gameId: number; homeAbbrev: string; awayAbbrev: string; sideHome: boolean; active: boolean }) {
  const [c, setC] = useState<(ChancesData & { state: string }) | null>(null);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (document.visibilityState === "visible") {
        const body = await fetch(`/api/live/${gameId}/chances`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        if (!cancelled && body) setC(body);
        if (body && (body.state === "OFF" || body.state === "FINAL")) return; // final: no more chances to count
      }
      if (!cancelled) timer = setTimeout(tick, 15_000);
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [gameId, active]);
  if (!c || c.shots.home + c.shots.away === 0) return null;
  const final = c.state === "OFF" || c.state === "FINAL";
  return <ChancesCard c={c} homeAbbrev={homeAbbrev} awayAbbrev={awayAbbrev} sideHome={sideHome} final={final} live={!final} />;
}
