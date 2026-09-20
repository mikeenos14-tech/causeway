import { getBruinsHeadlines } from "@/lib/news-data";
import { Masthead, Footer } from "@/components/Masthead";
import { HeadlinesList } from "@/components/HeadlinesList";

export default async function Headlines() {
  const headlines = await getBruinsHeadlines();

  return (
    <>
      <Masthead />
      <main style={{ maxWidth: 800, margin: "0 auto", padding: "3rem 24px 3.5rem" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.2rem,4.5vw,3rem)", textTransform: "uppercase", letterSpacing: ".01em", margin: "0 0 .4rem" }}>
          Headlines
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: ".9rem", marginBottom: "2rem" }}>
          Recent Bruins news from around the web, last 7 days · via Google News
        </p>

        {headlines.length > 0 ? (
          <HeadlinesList headlines={headlines} />
        ) : (
          <p style={{ color: "var(--text-secondary)", fontSize: ".9rem" }}>
            Couldn&apos;t load headlines right now — try again in a bit.
          </p>
        )}
      </main>
      <Footer />
    </>
  );
}
