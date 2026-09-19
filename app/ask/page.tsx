"use client";

import { useState } from "react";
import { Masthead, Footer } from "@/components/Masthead";

type QueryRecord = { sql: string; rows: Record<string, unknown>[] | null; error?: string };
type QAResult = {
  answer: string;
  queries: QueryRecord[];
  table: { columns: string[]; rows: Record<string, unknown>[] } | null;
  logId: number | null;
};

const EXAMPLE_QUESTIONS = [
  "Which Bruins goalie has the best save percentage in a single season, minimum 50 games played that season?",
  "How many career hat tricks does David Pastrnak have?",
  "Who scored the most points in a single Bruins season?",
  "How did the Bruins do in the 2012-13 lockout-shortened season compared to a full 82-game season?",
];

// A DB date/timestamp column serializes to an ISO string like
// "2019-10-14T04:00:00.000Z" — detected by shape, not column name, since
// the model names date columns differently per query (game_date, date,
// first_game, ...). Formatted using the UTC calendar date embedded in the
// string, not the viewer's own browser timezone — a viewer west of UTC
// interpreting this value in their local zone could roll the date back a
// day, which would silently show the wrong date.
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

// A season_id like "20162017" is really two concatenated years — unlike
// other ids (player_id, game_id) it has an obvious, meaningful human
// format, so it's reformatted rather than hidden like the opaque ones.
function formatSeasonId(value: string): string {
  if (!/^\d{8}$/.test(value)) return value;
  return `${value.slice(0, 4)}-${value.slice(6, 8)}`;
}

function formatCell(value: unknown, column: string): string {
  if (value === null || value === undefined) return "—";
  if (/season_id$/i.test(column)) return formatSeasonId(String(value));
  // Other identifiers are opaque, not quantities — no thousands separators.
  if (/(^|_)id$/i.test(column)) return String(value);
  if (typeof value === "string" && ISO_TIMESTAMP.test(value)) {
    return new Date(value).toLocaleDateString("en-US", {
      timeZone: "UTC",
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }
  if (typeof value === "number") return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return String(value);
}

// Opaque raw ids (id, player_id, game_id, ...) are meaningless to a fan
// reading the table — the prose and other columns already carry the
// human-readable version (name, date, opponent). season_id is kept, since
// formatCell reformats it into a real "2016-17" label instead of hiding
// it. Never leaves a table with zero columns.
function getDisplayColumns(columns: string[]): string[] {
  const filtered = columns.filter((c) => /season_id$/i.test(c) || !/(^|_)id$/i.test(c));
  return filtered.length > 0 ? filtered : columns;
}

function formatColumnHeader(column: string): string {
  if (/season_id$/i.test(column)) return "season";
  return column.replace(/_/g, " ");
}

export default function Ask() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QAResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showWork, setShowWork] = useState(false);
  const [flagState, setFlagState] = useState<"idle" | "editing" | "submitting" | "submitted">("idle");
  const [flagNote, setFlagNote] = useState("");

  async function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setShowWork(false);
    setFlagState("idle");
    setFlagNote("");
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function submitFlag(logId: number) {
    setFlagState("submitting");
    try {
      await fetch("/api/ask/flag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logId, note: flagNote.trim() || undefined }),
      });
    } catch {
      // Fast-detection is a nice-to-have, not critical path — fail quietly.
    }
    setFlagState("submitted");
  }

  return (
    <>
      <Masthead />
      <main style={{ maxWidth: 800, margin: "0 auto", padding: "2.5rem 24px 4rem" }}>
        <h1
          style={{
            fontFamily: "var(--font-editorial)",
            fontWeight: 600,
            fontSize: "clamp(1.9rem,3.6vw,2.4rem)",
            marginBottom: ".3rem",
          }}
        >
          Ask Causeway
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: ".95rem", marginBottom: "1.75rem", maxWidth: 560 }}>
          Ask any question about Bruins history. Every answer is generated live from the real
          database — no guessing, and every query behind it is shown below the answer.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(question);
          }}
          style={{ display: "flex", gap: ".6rem", marginBottom: "2.25rem" }}
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. What's the longest point streak by a Bruins player?"
            style={{
              flex: 1,
              minWidth: 0,
              padding: ".75rem 1rem",
              fontSize: "1rem",
              fontFamily: "var(--font-body)",
              border: "1px solid var(--border-strong)",
              borderRadius: 8,
              background: "var(--surface-1)",
              color: "var(--text-primary)",
            }}
          />
          <button
            type="submit"
            disabled={loading || question.trim().length === 0}
            style={{
              padding: ".75rem 1.4rem",
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              fontSize: "1.1rem",
              letterSpacing: ".02em",
              border: "none",
              borderRadius: 8,
              background: loading ? "var(--border-strong)" : "var(--gold)",
              color: "var(--ink)",
              cursor: loading ? "default" : "pointer",
            }}
          >
            {loading ? "Thinking…" : "Ask"}
          </button>
        </form>

        {!result && !loading && !error && (
          <div>
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 600,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                fontSize: "1rem",
                color: "var(--accent)",
                marginBottom: ".9rem",
              }}
            >
              Try asking
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: ".6rem" }}>
              {EXAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setQuestion(q);
                    ask(q);
                  }}
                  style={{
                    textAlign: "left",
                    padding: ".8rem 1rem",
                    fontFamily: "var(--font-body)",
                    fontSize: ".92rem",
                    color: "var(--text-primary)",
                    background: "var(--surface-1)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    cursor: "pointer",
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {loading && (
          <p style={{ color: "var(--text-muted)", fontFamily: "var(--font-editorial)", fontStyle: "italic" }}>
            Running queries against the real database…
          </p>
        )}

        {error && (
          <p style={{ color: "var(--loss)", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 8, padding: "1rem" }}>
            {error}
          </p>
        )}

        {result && (
          <div>
            <p
              style={{
                fontFamily: "var(--font-editorial)",
                fontSize: "1.15rem",
                lineHeight: 1.7,
                whiteSpace: "pre-wrap",
                marginBottom: result.table ? "1.75rem" : "1.5rem",
              }}
            >
              {result.answer}
            </p>

            {result.table && (
              <div style={{ marginBottom: "1.5rem", overflowX: "auto" }}>
                <table className="box-score-table">
                  <thead>
                    <tr>
                      {getDisplayColumns(result.table.columns).map((c) => (
                        <th key={c}>{formatColumnHeader(c)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.table.rows.map((row, i) => (
                      <tr key={i}>
                        {getDisplayColumns(result.table!.columns).map((c) => (
                          <td key={c}>{formatCell(row[c], c)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <button
              onClick={() => setShowWork((s) => !s)}
              style={{
                fontFamily: "var(--font-body)",
                fontSize: ".82rem",
                color: "var(--text-secondary)",
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              {showWork ? "Hide" : "Show"} the SQL behind this answer ({result.queries.length}{" "}
              {result.queries.length === 1 ? "query" : "queries"})
            </button>

            {showWork && (
              <div style={{ marginTop: ".9rem", display: "flex", flexDirection: "column", gap: ".9rem" }}>
                {result.queries.map((q, i) => (
                  <div
                    key={i}
                    style={{
                      background: "var(--surface-2)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: ".9rem 1rem",
                    }}
                  >
                    <pre
                      style={{
                        margin: 0,
                        fontSize: ".78rem",
                        fontFamily: "monospace",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        color: "var(--text-primary)",
                      }}
                    >
                      {q.sql}
                    </pre>
                    <p style={{ margin: ".5rem 0 0", fontSize: ".78rem", color: q.error ? "var(--loss)" : "var(--text-muted)" }}>
                      {q.error ? `Error: ${q.error}` : `${q.rows?.length ?? 0} row${q.rows?.length === 1 ? "" : "s"} returned`}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {result.logId !== null && (
              <div style={{ marginTop: ".9rem" }}>
                {flagState === "idle" && (
                  <button
                    onClick={() => setFlagState("editing")}
                    style={{
                      fontFamily: "var(--font-body)",
                      fontSize: ".78rem",
                      color: "var(--text-muted)",
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    Something look off? Let us know
                  </button>
                )}

                {flagState === "editing" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: ".5rem", maxWidth: 420 }}>
                    <textarea
                      value={flagNote}
                      onChange={(e) => setFlagNote(e.target.value)}
                      placeholder="What looks wrong? (optional)"
                      rows={2}
                      style={{
                        fontFamily: "var(--font-body)",
                        fontSize: ".82rem",
                        padding: ".5rem .6rem",
                        border: "1px solid var(--border-strong)",
                        borderRadius: 6,
                        background: "var(--surface-1)",
                        color: "var(--text-primary)",
                        resize: "vertical",
                      }}
                    />
                    <div style={{ display: "flex", gap: ".75rem" }}>
                      <button
                        onClick={() => submitFlag(result.logId!)}
                        style={{
                          fontFamily: "var(--font-body)",
                          fontSize: ".78rem",
                          color: "var(--text-primary)",
                          background: "var(--surface-2)",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          padding: ".35rem .7rem",
                          cursor: "pointer",
                        }}
                      >
                        Submit
                      </button>
                      <button
                        onClick={() => setFlagState("idle")}
                        style={{
                          fontFamily: "var(--font-body)",
                          fontSize: ".78rem",
                          color: "var(--text-muted)",
                          background: "none",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {flagState === "submitting" && (
                  <p style={{ fontFamily: "var(--font-body)", fontSize: ".78rem", color: "var(--text-muted)" }}>Sending…</p>
                )}

                {flagState === "submitted" && (
                  <p style={{ fontFamily: "var(--font-body)", fontSize: ".78rem", color: "var(--text-muted)" }}>
                    Thanks — flagged for review.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
