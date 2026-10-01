import type { ReactNode } from "react";
import { BannerMark } from "@/components/BannerMark";

// Shared frame for the link-preview images (app/opengraph-image.tsx and
// app/games/[id]/opengraph-image.tsx): what a Causeway link looks like in
// a group chat. Black and gold, the site's mark top-left, one big idea.
export const OG_SIZE = { width: 1200, height: 630 };
export const GOLD = "#ffb81c";
export const INK = "#0a0a0b";
export const MUTED = "#8a8a8f";

export function OgFrame({ label, children, footer }: { label: string; children: ReactNode; footer?: string }) {
  return (
    <div style={{ width: "100%", height: "100%", background: INK, color: "#f5f5f4", display: "flex", flexDirection: "column", padding: "56px 72px", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <BannerMark width={46} />
        <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: 4 }}>CAUSEWAY</div>
        <div style={{ marginLeft: "auto", fontSize: 26, fontWeight: 700, color: GOLD, letterSpacing: 3, textTransform: "uppercase" }}>{label}</div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>{children}</div>
      {footer && <div style={{ fontSize: 26, color: MUTED }}>{footer}</div>}
    </div>
  );
}

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}
