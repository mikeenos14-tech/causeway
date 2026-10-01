import { ImageResponse } from "next/og";
import { OgFrame, OG_SIZE, GOLD, MUTED } from "@/lib/og-card";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Causeway — Bruins stats, recaps, and answers";

// The default link preview for every page without its own (home, team
// pages, Ask, standings).
export default function Image() {
  return new ImageResponse(
    (
      <OgFrame label="Boston Bruins">
        <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1, letterSpacing: 1 }}>Every game.</div>
        <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1.05, color: GOLD }}>Every number.</div>
        <div style={{ fontSize: 34, color: MUTED, marginTop: 28 }}>Recaps, stats, and a box that answers your Bruins questions, every game since 2007-08.</div>
      </OgFrame>
    ),
    size,
  );
}
