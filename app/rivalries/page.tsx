import Link from "next/link";
import type { Metadata } from "next";
import { Masthead, Footer } from "@/components/Masthead";
import { heatColor, rivalryHref } from "@/components/Grudge";
import { getHottestRivalries, getColdWars, getTeamRivalries, heatLabel, type GrudgePair } from "@/lib/grudge-data";

// The Grudge Index, league-wide: the hottest rivalries now, the Cold Wars
// (furthest fallen from their peak), and every Bruins rivalry.

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Rivalries · Causeway",
  description: "The Grudge Index: how heated every NHL rivalry is right now, in both directions, from a century of playoff series, fights, blown leads and grudge matches.",
};

const H2 = { fontFamily: "var(--font-display)", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: ".02em", fontSize: "1.6rem", margin: "2.5rem 0 .4rem" };
const SUB = { fontSize: ".9rem", color: "var(--text-secondary)", margin: "0 0 1rem", maxWidth: "62ch", lineHeight: 1.5 };
const monthLabel = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : "");

function Num({ v }: { v: number }) {
  return <span style={{ fontFamily: "var(--font-display)", fontSize: "1.25rem", color: heatColor(v) }}>{Math.round(v)}</span>;
}

function PairRow({ p, rank }: { p: GrudgePair; rank?: number }) {
  const hot = p.ab.index >= p.ba.index ? p.ab : p.ba;
  const hotFrom = p.ab.index >= p.ba.index ? p.a.abbrev : p.b.abbrev;
  return (
    <Link href={rivalryHref(p.a.abbrev, p.b.abbrev)} className="dest-card" style={{ display: "grid", gridTemplateColumns: rank ? "1.6rem 1fr auto" : "1fr auto", gap: "4px 12px", alignItems: "center" }}>
      {rank && <span style={{ color: "var(--text-secondary)", fontWeight: 700 }}>{rank}</span>}
      <span>
        <span className="dest-card-title" style={{ display: "inline" }}>{p.a.abbrev} · {p.b.abbrev}</span>
        <span className="dest-card-teaser" style={{ display: "block" }}>{hot.top[0] ? `${hotFrom}: ${hot.top[0].text[0].toLowerCase()}${hot.top[0].text.slice(1)}` : ""}</span>
      </span>
      <span style={{ textAlign: "right", whiteSpace: "nowrap", fontSize: ".8rem", color: "var(--text-secondary)" }}>
        {p.a.abbrev} <Num v={p.ab.index} /> · {p.b.abbrev} <Num v={p.ba.index} />
      </span>
    </Link>
  );
}

export default async function RivalriesPage() {
  const [hottest, cold, bruins] = await Promise.all([getHottestRivalries(10), getColdWars(8), getTeamRivalries("BOS")]);
  return (
    <>
      <Masthead />
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "2.5rem 24px 3.5rem" }}>
        <Link href="/history" style={{ fontSize: ".85rem", color: "var(--text-secondary)", textDecoration: "none" }}>← Bruins history</Link>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.2rem,5vw,3.4rem)", lineHeight: 1, textTransform: "uppercase", margin: ".6rem 0 .8rem" }}>The Grudge Index</h1>
        <p style={{ ...SUB, fontSize: "1rem" }}>
          How heated every NHL rivalry is right now, from 0 to 100, in both directions: Toronto can hate Boston more than Boston hates Toronto. Playoff series, eliminations, Game 7s, fights, ejections, blown leads and close games all add heat, and old grudges cool over the years. 100 is the hottest any rivalry has ever been: Boston and Montreal in 1988, after five straight playoff meetings.
        </p>

        <h2 style={H2}>Hottest rivalries now</h2>
        <p style={SUB}>Ranked by the hotter direction. The line under each is its biggest reason.</p>
        <div style={{ display: "grid", gap: 10 }}>{hottest.map((p, i) => <PairRow key={`${p.a.abbrev}${p.b.abbrev}`} p={p} rank={i + 1} />)}</div>

        <h2 style={H2}>Cold wars</h2>
        <p style={SUB}>The rivalries that have cooled the most from their peak.</p>
        <div style={{ display: "grid", gap: 10 }}>
          {cold.map((p) => (
            <Link key={`${p.a.abbrev}${p.b.abbrev}`} href={rivalryHref(p.a.abbrev, p.b.abbrev)} className="dest-card" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <span>
                <span className="dest-card-title" style={{ display: "inline" }}>{p.thenA.name} · {p.thenB.name}</span>
                <span className="dest-card-teaser" style={{ display: "block" }}>
                  Peaked at {Math.round(p.peak)} in {monthLabel(p.peakMonth)}
                  {p.thenA.abbrev !== p.a.abbrev || p.thenB.abbrev !== p.b.abbrev ? ` · now ${p.a.abbrev} · ${p.b.abbrev}` : ""}
                </span>
              </span>
              <span style={{ whiteSpace: "nowrap", fontSize: ".85rem", color: "var(--text-secondary)" }}>
                <Num v={p.peak} /> → <Num v={Math.max(p.ab.index, p.ba.index)} />
              </span>
            </Link>
          ))}
        </div>

        <h2 style={H2}>Every Bruins rivalry</h2>
        <p style={SUB}>Boston&apos;s grudge toward each team, and theirs toward Boston.</p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9rem" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-secondary)", fontSize: ".75rem", textTransform: "uppercase", letterSpacing: ".04em" }}>
                <th style={{ padding: "8px 6px" }}>Team</th>
                <th style={{ padding: "8px 6px", textAlign: "right" }}>BOS toward</th>
                <th style={{ padding: "8px 6px", textAlign: "right" }}>Toward BOS</th>
                <th style={{ padding: "8px 6px" }}>Biggest reason</th>
              </tr>
            </thead>
            <tbody>
              {bruins.map((p) => {
                const hot = p.ab.index >= p.ba.index ? p.ab : p.ba;
                return (
                  <tr key={p.b.abbrev} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "9px 6px", whiteSpace: "nowrap" }}>
                      <Link href={rivalryHref("BOS", p.b.abbrev)} className="entity-link">{p.b.name}</Link>
                    </td>
                    <td style={{ padding: "9px 6px", textAlign: "right" }} title={heatLabel(p.ab.index)}><Num v={p.ab.index} /></td>
                    <td style={{ padding: "9px 6px", textAlign: "right" }} title={heatLabel(p.ba.index)}><Num v={p.ba.index} /></td>
                    <td style={{ padding: "9px 6px", color: "var(--text-secondary)", minWidth: 220 }}>{hot.top[0]?.text ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p style={{ ...SUB, fontSize: ".8rem", marginTop: "1.5rem" }}>
          How it works: each event adds heat that halves over time, from 1 year (a close game) to 10 (being eliminated). The scale is logarithmic against the all-time high, so 75 and up is hot and 90 and up is boiling. Fights are recorded from the 1940s on, so the oldest rivalries lean on playoff meetings. Teams are their franchise line: Dallas carries the North Stars&apos; history, Carolina the Whalers&apos;.
        </p>
      </main>
      <Footer />
    </>
  );
}
