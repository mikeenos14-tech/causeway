import Link from "next/link";
import { Headshot } from "@/components/Headshot";
import { formatSavePct } from "@/lib/util/save-pct";

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

function LeaderCard({ label, leader, value, headshots }: { label: string; leader: Leader; value: React.ReactNode; headshots: Record<number, string> }) {
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
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <Headshot url={headshots[leader.id]} name={leader.full_name} size={32} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: ".68rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
          <div style={{ fontSize: ".92rem", fontWeight: 700 }}>{leader.full_name}</div>
        </div>
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: "1.8rem", color: "var(--gold)" }}>{value}</div>
    </Link>
  );
}

export function StatLeaders({ statLeaders, caption, headshots = {} }: { statLeaders: StatLeadersData; caption?: string; headshots?: Record<number, string> }) {
  const anyLeader =
    statLeaders.points || statLeaders.goals || statLeaders.assists || statLeaders.plusMinus || statLeaders.hits || statLeaders.blocks || statLeaders.goalie;

  return (
    <section>
      <div style={{ marginBottom: "1rem", display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.5rem", textTransform: "uppercase", letterSpacing: ".02em" }}>Stat Leaders</h2>
        {caption && <span style={{ fontSize: ".78rem", color: "var(--text-secondary)" }}>{caption}</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        {statLeaders.points && <LeaderCard headshots={headshots} label="Points" leader={statLeaders.points} value={statLeaders.points.points as number} />}
        {statLeaders.goals && <LeaderCard headshots={headshots} label="Goals" leader={statLeaders.goals} value={statLeaders.goals.goals as number} />}
        {statLeaders.assists && <LeaderCard headshots={headshots} label="Assists" leader={statLeaders.assists} value={statLeaders.assists.assists as number} />}
        {statLeaders.plusMinus && (
          <LeaderCard
            headshots={headshots}
            label="+/-"
            leader={statLeaders.plusMinus}
            value={`${(statLeaders.plusMinus.plus_minus as number) > 0 ? "+" : ""}${statLeaders.plusMinus.plus_minus}`}
          />
        )}
        {statLeaders.hits && <LeaderCard headshots={headshots} label="Hits" leader={statLeaders.hits} value={statLeaders.hits.hits as number} />}
        {statLeaders.blocks && <LeaderCard headshots={headshots} label="Blocks" leader={statLeaders.blocks} value={statLeaders.blocks.blocks as number} />}
        {statLeaders.goalie && <LeaderCard headshots={headshots} label="Save %" leader={statLeaders.goalie} value={formatSavePct(statLeaders.goalie.savePct)} />}
        {!anyLeader && <p style={{ color: "var(--text-secondary)", fontSize: ".9rem" }}>No stat leaders on file yet for this team&apos;s most recent loaded season.</p>}
      </div>
    </section>
  );
}
