"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Saved to an iPhone home screen, the site runs as a standalone web app
// that iOS keeps suspended in memory: reopening it resumes the old page
// instead of loading a fresh one, so scores and standings stayed stale
// until the app was force-quit (owner report, 2026-10-02). When the page
// comes back after a while away, fetch fresh content in place
// (router.refresh keeps scroll position and anything typed). The live
// scoreboard already re-polls on its own when it becomes visible.
const AWAY_MS = 30_000;

export function RefreshOnReturn() {
  const router = useRouter();
  useEffect(() => {
    let hiddenAt: number | null = document.visibilityState === "hidden" ? Date.now() : null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (hiddenAt != null) {
        const away = Date.now() - hiddenAt;
        hiddenAt = null;
        if (away > AWAY_MS) router.refresh();
      }
    };
    // Safari's back/forward cache restores a frozen copy of the page.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) router.refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [router]);
  return null;
}
