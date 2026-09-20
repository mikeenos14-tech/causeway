"use client";

import { useEffect, useRef, useState } from "react";

export type KeyItem = { term: string; definition: string };

// A small "ⓘ Key" toggle instead of either (a) a permanent block of
// definitions pushing the real content down the page, or (b) a separate
// page/route that navigates someone away from the table they were just
// reading. Closes on outside click or Escape; positioned to hug the
// button that opened it rather than centering over the page, since this
// is a reference panel for the table right below it, not a modal dialog.
export function StatsKey({ items }: { items: KeyItem[] }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: open ? "rgba(255,184,28,0.12)" : "var(--surface-1)",
          border: open ? "1px solid var(--gold)" : "1px solid var(--border)",
          borderRadius: 999,
          padding: "6px 14px 6px 11px",
          fontFamily: "var(--font-body)",
          fontSize: ".8rem",
          fontWeight: 600,
          color: open ? "var(--gold)" : "var(--text-secondary)",
          cursor: "pointer",
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <circle cx="12" cy="12" r="9" />
          <line x1="12" y1="11" x2="12" y2="16.5" />
          <circle cx="12" cy="7.7" r="0.6" fill="currentColor" stroke="none" />
        </svg>
        Key
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Stat definitions"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: "min(360px, 88vw)",
            maxHeight: "60vh",
            overflowY: "auto",
            background: "var(--surface-2)",
            border: "1px solid var(--border-strong)",
            borderRadius: 12,
            boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
            padding: "6px",
            zIndex: 30,
          }}
        >
          {items.map((item, i) => (
            <div key={item.term} style={{ padding: "10px 12px", borderBottom: i < items.length - 1 ? "1px solid var(--border)" : "none" }}>
              <div style={{ fontSize: ".8rem", fontWeight: 700, color: "var(--gold)", marginBottom: 3 }}>{item.term}</div>
              <div style={{ fontSize: ".82rem", color: "var(--text-secondary)", lineHeight: 1.45 }}>{item.definition}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
