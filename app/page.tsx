import { Masthead, Footer } from "@/components/Masthead";
import { TeamSubNav } from "@/components/TeamSubNav";
import { TeamDashboard } from "@/components/TeamDashboard";

export const revalidate = 300;

// The homepage is Boston's team dashboard — same component as every
// /teams/[abbrev] overview, in its full-size form with the Ask band.
export default async function Home() {
  return (
    <>
      <Masthead />
      <main style={{ maxWidth: 1160, margin: "0 auto", padding: "0 24px 3.5rem" }}>
        <div style={{ paddingTop: "1.25rem" }}>
          <TeamSubNav abbrev="BOS" />
        </div>
        <TeamDashboard abbrev="BOS" />
      </main>
      <Footer />
    </>
  );
}
