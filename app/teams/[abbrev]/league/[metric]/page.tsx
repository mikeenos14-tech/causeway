import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTeam } from "@/lib/homepage-data";
import { getLeagueComparisonSeason, getLeagueTeamStats } from "@/lib/league-data";
import { LEAGUE_METRICS, metricBySlug, ordinal, rankAll } from "@/lib/league-metrics";
import { formatSeasonLabel } from "@/lib/format-date";
import { Masthead, Footer } from "@/components/Masthead";
import { TeamSubNav } from "@/components/TeamSubNav";
import { TeamLogo } from "@/components/TeamLogo";

// One stat, every team: the full league table behind a League Ranks tile
// (/teams/BOS/league/power-play), with the team whose page this is
// highlighted. Same season rule and numbers as the tiles (lib/league-metrics).

export const revalidate = 300;
export async function generateStaticParams() {
  return []; // rendered on first visit, then cached (a [param] route needs this for revalidate)
}

export async function generateMetadata({ params }: { params: Promise<{ abbrev: string; metric: string }> }): Promise<Metadata> {
  const { metric } = await params;
  const m = metricBySlug(metric);
  return { title: m ? `${m.label}: League Rankings · Causeway` : "League Rankings · Causeway" };
}

export default async function MetricRankings({ params }: { params: Promise<{ abbrev: string; metric: string }> }) {
  const { abbrev: raw, metric } = await params;
  const abbrev = raw.toUpperCase();
  const m = metricBySlug(metric);
  const team = await getTeam(abbrev);
  if (!m || !team) notFound();

  const { seasonId, pending } = await getLeagueComparisonSeason();
  const teams = seasonId ? await getLeagueTeamStats(seasonId) : [];
  const ranked = rankAll(teams, m);
  const missing = teams.filter((t) => !ranked.some((r) => r.team.abbrev === t.abbrev));
  const values = ranked.map((r) => r.value);
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const chip = (on: boolean) => ({ padding: "5px 11px", borderRadius: 999, border: "1px solid var(--border)", fontSize: ".8rem", fontWeight: 600, textDecoration: "none", color: on ? "var(--ink)" : "var(--text-primary)", background: on ? "var(--gold)" : "transparent", whiteSpace: "nowrap" as const });

  return (
    <>
      <Masthead />
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "1.5rem 24px 3.5rem" }}>
        <TeamSubNav abbrev={abbrev} />
        <Link href={`/teams/${abbrev}/league`} style={{ fontSize: ".85rem", color: "var(--text-secondary)", textDecoration: "none" }}>
          ← {abbrev} League Ranks
        </Link>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2rem,4.5vw,2.8rem)", textTransform: "uppercase", letterSpacing: ".01em", margin: ".5rem 0 .3rem" }}>{m.label}</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: ".9rem", margin: "0 0 1.2rem" }}>
          {seasonId ? `${formatSeasonLabel(seasonId)} regular season${pending ? " · final" : " so far"} · every NHL team` : "No season loaded yet"}
          {avg != null ? ` · league average ${m.format(avg)}` : ""}
          {!m.higherIsBetter ? " · lower is better" : ""}
        </p>
        <nav aria-label="Other stats" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: "1.4rem" }}>
          {LEAGUE_METRICS.filter((x) => teams.some((t) => x.covered(t))).map((x) => (
            <Link key={x.slug} href={`/teams/${abbrev}/league/${x.slug}`} style={chip(x.slug === m.slug)} aria-current={x.slug === m.slug ? "page" : undefined}>
              {x.label.replace(" / Game", "/G").replace("Expected Goals", "xG")}
            </Link>
          ))}
        </nav>

        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {ranked.map((r) => {
            const mine = r.team.abbrev === abbrev;
            return (
              <li
                key={r.team.abbrev}
                aria-current={mine ? "true" : undefined}
                style={{
                  display: "grid",
                  gridTemplateColumns: "3.4rem 1fr auto",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  borderTop: "1px solid var(--border)",
                  background: mine ? "rgba(255, 184, 28, .10)" : "transparent",
                  borderLeft: mine ? "3px solid var(--gold)" : "3px solid transparent",
                }}
              >
                <span style={{ fontWeight: 700, color: mine ? "var(--gold)" : "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                  {r.tied ? "T-" : ""}
                  {ordinal(r.rank)}
                </span>
                <Link href={`/teams/${r.team.abbrev}`} className="entity-link" style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: mine ? 700 : 500, minWidth: 0 }}>
                  <TeamLogo abbrev={r.team.abbrev} size={22} gap={0} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.team.name}</span>
                </Link>
                <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  <strong>{m.format(r.value)}</strong>
                  <span style={{ display: "block", fontSize: ".75rem", color: "var(--text-secondary)" }}>{m.detail(r.team)}</span>
                </span>
              </li>
            );
          })}
        </ol>
        {missing.length > 0 && (
          <p style={{ fontSize: ".8rem", color: "var(--text-secondary)", marginTop: "1rem" }}>
            Not ranked yet (this season&apos;s data still loading): {missing.map((t) => t.abbrev).join(", ")}.
          </p>
        )}
        <p style={{ fontSize: ".75rem", color: "var(--text-secondary)", marginTop: "1rem" }}>
          Teams level on {m.label.toLowerCase()} share a rank (T-). {m.group === "xg" ? "Expected goals via MoneyPuck.com." : ""}
        </p>
      </main>
      <Footer />
    </>
  );
}
