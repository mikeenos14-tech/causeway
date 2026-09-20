import Link from "next/link";

type Leader = { id: number; full_name: string } & Record<string, unknown>;

export type StatLeadersData = {
  points: Leader | null;
  goals: Leader | null;
  assists: Leader | null;
  plusMinus: Leader | null;
  hits: Leader | null;
  blocks: Leader | null;
  goalie: (Leader & { savePct: number }) | null;
};

function LeaderCard({ label, leader, value }: { label: string; leader: Leader; value: React.ReactNode }) {
  return (
    <Link
      href={`/players/${leader.id}`}
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "14px 18px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div>
        <div style={{ fontSize: ".68rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
        <div style={{ fontSize: ".92rem", fontWeight: 700 }}>{leader.full_name}</div>
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: "1.8rem", color: "var(--gold)" }}>{value}</div>
    </Link>
  );
}

export function StatLeaders({ abbrev, statLeaders }: { abbrev: string; statLeaders: StatLeadersData }) {
  const anyLeader =
    statLeaders.points || statLeaders.goals || statLeaders.assists || statLeaders.plusMinus || statLeaders.hits || statLeaders.blocks || statLeaders.goalie;

  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "1rem", flexWrap: "wrap", gap: "6px 14px" }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.5rem", textTransform: "uppercase", letterSpacing: ".02em" }}>Stat Leaders</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px" }}>
          <Link href={`/teams/${abbrev}/roster`} style={{ fontSize: ".82rem", fontWeight: 600, color: "var(--gold)", textDecoration: "none" }}>
            Full roster &amp; stats →
          </Link>
          <Link href={`/teams/${abbrev}/league`} style={{ fontSize: ".82rem", fontWeight: 600, color: "var(--gold)", textDecoration: "none" }}>
            League comparison →
          </Link>
          <Link href={`/teams/${abbrev}/records`} style={{ fontSize: ".82rem", fontWeight: 600, color: "var(--gold)", textDecoration: "none" }}>
            Records &amp; streaks →
          </Link>
          <Link href={`/teams/${abbrev}/series`} style={{ fontSize: ".82rem", fontWeight: 600, color: "var(--gold)", textDecoration: "none" }}>
            Season series →
          </Link>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        {statLeaders.points && <LeaderCard label="Points" leader={statLeaders.points} value={statLeaders.points.points as number} />}
        {statLeaders.goals && <LeaderCard label="Goals" leader={statLeaders.goals} value={statLeaders.goals.goals as number} />}
        {statLeaders.assists && <LeaderCard label="Assists" leader={statLeaders.assists} value={statLeaders.assists.assists as number} />}
        {statLeaders.plusMinus && (
          <LeaderCard
            label="+/-"
            leader={statLeaders.plusMinus}
            value={`${(statLeaders.plusMinus.plus_minus as number) > 0 ? "+" : ""}${statLeaders.plusMinus.plus_minus}`}
          />
        )}
        {statLeaders.hits && <LeaderCard label="Hits" leader={statLeaders.hits} value={statLeaders.hits.hits as number} />}
        {statLeaders.blocks && <LeaderCard label="Blocks" leader={statLeaders.blocks} value={statLeaders.blocks.blocks as number} />}
        {statLeaders.goalie && <LeaderCard label="Save %" leader={statLeaders.goalie} value={statLeaders.goalie.savePct.toFixed(3)} />}
        {!anyLeader && <p style={{ color: "var(--text-secondary)", fontSize: ".9rem" }}>No stat leaders on file yet for this team&apos;s most recent loaded season.</p>}
      </div>
    </section>
  );
}
