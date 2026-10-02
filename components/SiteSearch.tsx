"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SearchIndex } from "@/app/api/search-index/route";
import { search, type SearchHit } from "@/lib/search";
import { TeamLogo } from "@/components/TeamLogo";

// The header's search: players and teams appear as you type (searched in
// the browser over a small index fetched once), and anything else is one
// Enter away from being asked as a question. Before this, the only search
// was Ask, which takes 15-30 seconds and a model call even to find a
// player's page.

let indexPromise: Promise<SearchIndex> | null = null;
const loadIndex = () => (indexPromise ??= fetch("/api/search-index").then((r) => r.json()));

export function SiteSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [indexFailed, setIndexFailed] = useState(false);
  // Enter pressed before the index arrived: finish it once it does (found in
  // testing: Enter on "marc" mid-load sent it to Ask as a question).
  const pendingEnter = useRef(false);
  const queryRef = useRef("");

  const hits: SearchHit[] = index ? search(index, query) : [];
  // Ask is only offered next to real results (or if they can't load), so a
  // half-typed name is never mistaken for a question.
  const askRow = query.trim().length > 0 && (index !== null || indexFailed);
  const rows = hits.length + (askRow ? 1 : 0);

  function show() {
    setOpen(true);
    loadIndex().then(
      (idx) => {
        setIndex(idx);
        if (pendingEnter.current) {
          pendingEnter.current = false;
          const best = search(idx, queryRef.current)[0];
          navigate(best ? best.href : `/ask?q=${encodeURIComponent(queryRef.current.trim())}`);
        }
      },
      () => {
        indexPromise = null;
        setIndexFailed(true);
      },
    );
  }
  function navigate(href: string) {
    close();
    router.push(href);
  }
  function close() {
    setOpen(false);
    setQuery("");
    queryRef.current = "";
    pendingEnter.current = false;
    setActive(0);
  }
  function go(i: number) {
    const hit = hits[i];
    navigate(hit ? hit.href : `/ask?q=${encodeURIComponent(query.trim())}`);
  }

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Close on a click outside the panel or Escape anywhere.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="masthead-ask" style={{ position: "relative" }}>
      {/* Hovering or touching the button starts loading the index, so it's
          usually ready before the first keystroke. */}
      <button type="button" onClick={show} onPointerEnter={() => loadIndex()} onFocus={() => loadIndex()} aria-haspopup="dialog" aria-expanded={open} className="site-search-button">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2.4" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        Search or ask
      </button>
      {open && (
        <div ref={panelRef} role="dialog" aria-label="Search players and teams, or ask a question" className="site-search-panel">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              queryRef.current = e.target.value;
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, Math.max(rows - 1, 0)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter" && !index && !indexFailed && query.trim()) {
                e.preventDefault();
                pendingEnter.current = true;
              } else if (e.key === "Enter" && rows > 0) {
                e.preventDefault();
                go(active);
              }
            }}
            placeholder="Pastrnak, Rangers, or any Bruins question"
            role="combobox"
            aria-expanded={rows > 0}
            aria-controls="site-search-results"
            aria-activedescendant={rows > 0 ? `site-search-${active}` : undefined}
            aria-autocomplete="list"
            className="site-search-input"
          />
          {rows > 0 && (
            <ul id="site-search-results" role="listbox" className="site-search-results">
              {hits.map((h, i) => (
                <li
                  key={h.href}
                  id={`site-search-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    go(i);
                  }}
                  className="site-search-row"
                >
                  <span style={{ fontWeight: 600 }}>
                    {h.kind === "team" && <TeamLogo abbrev={h.detail} size={20} gap={6} />}
                    {h.title}
                  </span>
                  <span style={{ fontSize: ".78rem", color: "#a8a69e" }}>{h.kind === "team" ? `Team · ${h.detail}` : h.detail}</span>
                </li>
              ))}
              {askRow && (
                <li
                  id={`site-search-${hits.length}`}
                  role="option"
                  aria-selected={active === hits.length}
                  onMouseEnter={() => setActive(hits.length)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    go(hits.length);
                  }}
                  className="site-search-row"
                >
                  <span>
                    <span style={{ color: "var(--gold)", fontWeight: 600 }}>Ask Causeway:</span> &ldquo;{query.trim()}&rdquo;
                  </span>
                  <span style={{ fontSize: ".78rem", color: "#a8a69e" }}>answered from the database, about 20 seconds</span>
                </li>
              )}
            </ul>
          )}
          {!index && query.trim().length >= 2 && <p style={{ margin: "8px 4px 0", fontSize: ".8rem", color: "#a8a69e" }}>Loading players…</p>}
        </div>
      )}
    </div>
  );
}
