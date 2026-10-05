import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { Masthead, Footer } from "@/components/Masthead";
import { TeamLink } from "@/components/EntityLinks";
import { TwoWayGauge, GrudgeTimeline } from "@/components/Grudge";
import { getGrudge, getGrudgeTimeline, getGrudgeMoments, type GrudgeMoment } from "@/lib/grudge-data";

// One rivalry: both teams' grudges now, its heat since the first meeting,
// the top reasons each way, and its defining moments. /rivalries/BOS-MTL.

export const revalidate = 3600;
export function generateStaticParams() {
  return []; // rendered on first visit, then cached (revalidate needs this with a [param])
}

const parse = (pair: string) => {
  const m = /^([A-Z]{3})-([A-Z]{3})$/.exec(pair.toUpperCase());
  return m ? [m[1], m[2]] : null;
};

export async function generateMetadata({ params }: { params: Promise<{ pair: string }> }): Promise<Metadata> {
  const ab = parse((await params).pair);
  const p = ab ? await getGrudge(ab[0], ab[1]) : null;
  if (!p) return { title: "Rivalry · Causeway" };
  const title = `${p.a.name} vs ${p.b.name}: the Grudge Index · Causeway`;
  const description = `${p.a.abbrev} toward ${p.b.abbrev}: ${Math.round(p.ab.index)}. ${p.b.abbrev} toward ${p.a.abbrev}: ${Math.round(p.ba.index)}. ${p.ab.top[0]?.text ?? ""}`;
  return { title, description, openGraph: { title, description } };
}

const KIND: Record<GrudgeMoment["kind"], string> = { series: "Playoffs", blown: "Blown lead", ejection: "Ejection", fights: "Fights", pim: "Penalties" };
const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default async function RivalryPage({ params }: { params: Promise<{ pair: string }> }) {
  const raw = (await params).pair;
  const ab = parse(raw);
  if (!ab) notFound();
  if (raw !== raw.toUpperCase()) redirect(`/rivalries/${raw.toUpperCase()}`);
  const p = await getGrudge(ab[0], ab[1]);
  if (!p) notFound();
  const [timeline, moments] = await Promise.all([getGrudgeTimeline(p.a, p.b), getGrudgeMoments(p.a, p.b)]);
  const reasons = (from: string, to: string, list: typeof p.ab.top) =>
    list.length > 0 && (
      <div style={{ flex: "1 1 280px" }}>
        <div style={{ fontSize: ".75rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>Why {from} holds a grudge toward {to}</div>
        <ol style={{ margin: 0, paddingLeft: "1.3rem", lineHeight: 1.6, listStyle: "decimal" }}>{list.map((r, i) => <li key={i}>{r.text}</li>)}</ol>
      </div>
    );
  return (
    <>
      <Masthead />
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "2.5rem 24px 3.5rem" }}>
        <Link href="/rivalries" style={{ fontSize: ".85rem", color: "var(--text-secondary)", textDecoration: "none" }}>← All rivalries</Link>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2rem,4.5vw,3.2rem)", lineHeight: 1, textTransform: "uppercase", margin: ".6rem 0 1.2rem" }}>
          <TeamLink abbrev={p.a.abbrev}>{p.a.name}</TeamLink> <span style={{ color: "var(--text-secondary)" }}>vs</span> <TeamLink abbrev={p.b.abbrev}>{p.b.name}</TeamLink>
        </h1>
        <TwoWayGauge p={p} title="Heat right now" />
        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginBottom: "2.5rem" }}>
          {reasons(p.a.abbrev, p.b.abbrev, p.ab.top)}
          {reasons(p.b.abbrev, p.a.abbrev, p.ba.top)}
        </div>

        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 600, textTransform: "uppercase", fontSize: "1.5rem", margin: "0 0 .8rem" }}>Heat over time</h2>
        <GrudgeTimeline points={timeline} a={p.a.abbrev} b={p.b.abbrev} />

        {moments.length > 0 && (
          <>
            <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 600, textTransform: "uppercase", fontSize: "1.5rem", margin: "0 0 .8rem" }}>Defining moments</h2>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {moments.map((m, i) => (
                <li key={i} style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", padding: "9px 0", borderTop: "1px solid var(--border)", fontSize: ".9rem", alignItems: "baseline" }}>
                  <span style={{ color: "var(--text-secondary)", width: "6.5rem" }}>{m.gameId ? <Link href={`/games/${m.gameId}`} className="entity-link">{fmt(m.date)}</Link> : fmt(m.date)}</span>
                  <span style={{ fontSize: ".72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", width: "6.5rem", color: m.kind === "series" ? "var(--gold)" : "var(--text-secondary)" }}>{KIND[m.kind]}</span>
                  <span style={{ flex: "1 1 260px" }}>{m.text}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
