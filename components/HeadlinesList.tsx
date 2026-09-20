"use client";

import { useState } from "react";
import type { Headline } from "@/lib/news-data";
import { formatRelativeTime } from "@/lib/format-relative-time";

const PAGE_SIZE = 5;

export function HeadlinesList({ headlines }: { headlines: Headline[] }) {
  const [shown, setShown] = useState(PAGE_SIZE);
  const visible = headlines.slice(0, shown);

  return (
    <div>
      <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        {visible.map((h, i) => (
          <a
            key={h.link}
            href={h.link}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "block",
              padding: "16px 18px",
              textDecoration: "none",
              color: "inherit",
              borderTop: i === 0 ? "none" : "1px solid var(--border)",
            }}
          >
            <div style={{ fontSize: ".95rem", fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.4, marginBottom: 6 }}>{h.title}</div>
            <div style={{ fontSize: ".78rem", color: "var(--text-secondary)" }}>
              <span style={{ color: "var(--gold)", fontWeight: 600 }}>{h.source}</span> · {formatRelativeTime(h.publishedAt)}
            </div>
          </a>
        ))}
      </div>

      {shown < headlines.length && (
        <button
          onClick={() => setShown((s) => s + PAGE_SIZE)}
          style={{
            display: "block",
            width: "100%",
            marginTop: 12,
            padding: "12px",
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            color: "var(--gold)",
            fontWeight: 600,
            fontSize: ".85rem",
            cursor: "pointer",
          }}
        >
          Show more ({headlines.length - shown} more)
        </button>
      )}
    </div>
  );
}
