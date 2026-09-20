"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Replaces the old "→" link row that used to live inside StatLeaders —
// that worked when there were two sub-pages, but wrapped into a cramped
// 2x2 grid of text links on mobile once Records and Season Series joined
// Roster and League (confirmed live at 375px before building this). A
// real tab bar scales the way that link row didn't.
const TABS = [
  { label: "Overview", path: "" },
  { label: "Roster", path: "/roster" },
  { label: "League", path: "/league" },
  { label: "Records", path: "/records" },
  { label: "Series", path: "/series" },
  { label: "Playoffs", path: "/playoffs" },
  { label: "Advanced", path: "/advanced" },
];

export function TeamSubNav({ abbrev }: { abbrev: string }) {
  const pathname = usePathname();
  const base = `/teams/${abbrev}`;
  const scrollerRef = useRef<HTMLElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Each team sub-page renders its own <TeamSubNav>, not a shared layout,
  // so clicking a tab remounts this component fresh on a scrolled-to-the-
  // start nav — you'd land on e.g. Advanced and have to re-scroll right
  // every single time just to see which tab you're actually on. Centering
  // the active tab on mount keeps your place visible without you doing
  // anything; instant (no animation) since this is a page load settling
  // into place, not a scroll the user asked for.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "instant", inline: "center", block: "nearest" });
  }, []);

  // A real user found this the hard way: on a narrow screen only 4 of 7
  // tabs fit, and the only hint the rest existed was a 2px-tall scrollbar
  // sliver — easy to miss entirely ("the tabs aren't showing up"). Fade +
  // arrow on whichever edge still has hidden tabs is a much louder signal,
  // and it updates live as you scroll so it never lies about which
  // direction still has more.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => {
      setCanScrollLeft(el.scrollLeft > 2);
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div style={{ position: "relative", marginBottom: "2rem" }}>
      <nav
        ref={scrollerRef}
        style={{
          display: "flex",
          gap: 4,
          width: "100%",
          minWidth: 0,
          maxWidth: "100%",
          overflowX: "auto",
          overflowY: "hidden",
          // Without this, a swipe that's even slightly diagonal gets
          // grabbed by the page's own vertical scroll instead of this
          // element's horizontal one — pan-x tells the browser this
          // element only ever pans sideways, so touch gestures on it
          // don't fight with scrolling the rest of the page.
          touchAction: "pan-x",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {TABS.map((tab) => {
          const href = `${base}${tab.path}`;
          // Overview also matches the homepage itself when that's BOS, so a
          // Bruins visitor sees it highlighted from "/" too, not just
          // "/teams/BOS".
          const active = tab.path === "" ? pathname === base || (pathname === "/" && abbrev === "BOS") : pathname === href;
          return (
            <Link
              key={tab.label}
              href={href}
              ref={active ? activeRef : undefined}
              style={{
                padding: "10px 16px",
                fontSize: ".85rem",
                fontWeight: 600,
                whiteSpace: "nowrap",
                color: active ? "var(--gold)" : "var(--text-secondary)",
                textDecoration: "none",
                borderBottom: active ? "2px solid var(--gold)" : "2px solid transparent",
                marginBottom: -1,
              }}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {canScrollLeft && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 1,
            width: 32,
            background: "linear-gradient(to right, var(--bg) 20%, transparent)",
            display: "flex",
            alignItems: "center",
            pointerEvents: "none",
          }}
        >
          <span style={{ color: "var(--gold)", fontSize: ".8rem" }}>‹</span>
        </div>
      )}
      {canScrollRight && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 1,
            width: 32,
            background: "linear-gradient(to left, var(--bg) 20%, transparent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            pointerEvents: "none",
          }}
        >
          <span style={{ color: "var(--gold)", fontSize: ".8rem" }}>›</span>
        </div>
      )}
    </div>
  );
}
