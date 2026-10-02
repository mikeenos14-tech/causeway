import Link from "next/link";
import type { Metadata } from "next";
import { Masthead, Footer } from "@/components/Masthead";
import { getBruinsBiggestGoals, getBruinsLeverageLeaders, playersWithPages } from "@/lib/leverage-data";
import { GoalTable, LeaderTable, LeverageNav, LeverageIntro, H2, SUB } from "@/components/LeverageTables";

// Leverage Goals, Bruins side (spec section 8): the biggest goals in team
// history by what they did to the chance of winning, and the leaders.

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Goals That Moved Games · Causeway",
  description: "Every Bruins goal since 1924 measured by how much it changed the chance of winning: the biggest goals in team history and the players who scored them.",
};

export default async function LeveragePage() {
  const [playoffGoals, goals, regular, playoff] = await Promise.all([
    getBruinsBiggestGoals("playoff", 25),
    getBruinsBiggestGoals("wpa", 50),
    getBruinsLeverageLeaders("regular", "lg", 15),
    getBruinsLeverageLeaders("playoff", "lg", 15),
  ]);
  const linked = await playersWithPages([...playoffGoals, ...goals].map((g) => g.scorerId).concat([...regular, ...playoff].map((r) => r.playerId)));

  return (
    <>
      <Masthead />
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "2.5rem 24px 3.5rem" }}>
        <Link href="/history" style={{ fontSize: ".85rem", color: "var(--text-secondary)", textDecoration: "none" }}>
          ← Bruins history
        </Link>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.2rem,5vw,3.4rem)", lineHeight: 1, textTransform: "uppercase", margin: ".6rem 0 .8rem" }}>
          Goals That Moved Games
        </h1>
        <LeverageIntro />
        <LeverageNav active="bruins" />

        <section style={{ marginBottom: "2.75rem" }}>
          <h2 style={H2}>Biggest Bruins playoff goals</h2>
          <p style={SUB}>By how much each goal moved the Bruins&rsquo; chance of winning the series: the goal&rsquo;s win chance added, times how much its game mattered.</p>
          <GoalTable goals={playoffGoals} linked={linked} showStakes />
        </section>

        <section style={{ marginBottom: "2.75rem" }}>
          <h2 style={H2}>Bruins leaders</h2>
          <p style={SUB}>Goals for Boston only. Regular season: wins added by a player&rsquo;s goals. Playoffs: series added, each goal weighted by its game&rsquo;s stakes.</p>
          <div style={{ display: "grid", gap: "1.5rem" }}>
            <div>
              <h3 style={{ fontSize: ".8rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--text-secondary)", margin: "0 0 .5rem" }}>Regular season</h3>
              <LeaderTable rows={regular} linked={linked} showTeam={false} />
            </div>
            <div>
              <h3 style={{ fontSize: ".8rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--text-secondary)", margin: "0 0 .5rem" }}>Playoffs</h3>
              <LeaderTable rows={playoff} linked={linked} playoff showTeam={false} />
            </div>
          </div>
        </section>

        <section>
          <h2 style={H2}>The 50 biggest Bruins goals</h2>
          <p style={SUB}>
            By win chance added in their own game, regular season and playoffs. Overtime winners and late tying goals dominate, as they should: a game
            tied in overtime is about a coin flip, and the winner takes it to 100%.
          </p>
          <GoalTable goals={goals} linked={linked} />
        </section>
      </main>
      <Footer />
    </>
  );
}
