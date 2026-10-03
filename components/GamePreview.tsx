import Link from "next/link";
import type { Preview, PreviewTeam } from "@/lib/preview-data";
import { formatStartTimeET } from "@/lib/nhl-schedule";
import { formatGameDate } from "@/lib/format-date";
import { milestoneText } from "@/lib/milestones-data";
import { FormBars } from "@/components/Sparkline";
import { LiveScoreboard } from "@/components/LiveScoreboard";

import { AskAboutGame, gameQuestions } from "@/components/AskAboutGame";
import { TeamLogo } from "@/components/TeamLogo";
import { TeamLink } from "@/components/EntityLinks";
import { EloOddsBar } from "@/components/EloOdds";

const H2 = { margin: "0 0 .9rem", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.35rem", textTransform: "uppercase" as const, letterSpacing: ".02em" };
const CARD = { background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.1rem 1.3rem" } as const;
const LABEL = { fontSize: ".72rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase" as const, letterSpacing: ".05em" };

// The pre-game page for a game that hasn't been played (or is in progress):
// /games/[id] renders this until the game is in our database, then the box
// score. Every number is from our own database or the NHL's feed; no model.
export function GamePreview({ p }: { p: Preview }) {
  // Bruins games only: the follow-ups a fan would ask before puck drop.
  const bos = p.home.abbrev === "BOS" ? p.home : p.away.abbrev === "BOS" ? p.away : null;
  const opp = bos === p.home ? p.away : p.home;
  const askQuestions = bos ? gameQuestions({ opponent: opp.fullName, skater: bos.topSkaters[0]?.name ?? null }) : [];
  const live = p.state === "LIVE" || p.state === "CRIT";
  const final = p.state === "FINAL" || p.state === "OFF" || p.state === "OVER"; // OVER: horn gone, not yet official
  return (
    <>
      <section style={{ marginBottom: "2rem", paddingBottom: "1.75rem", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: live ? "var(--loss)" : "var(--gold)", display: "block", marginBottom: ".6rem", fontSize: ".95rem" }}>
          {live ? "In progress" : final ? "Final — box score coming" : `${p.gameType === 3 ? "Playoffs · " : ""}${p.tag ? `${p.tag} · ` : ""}Preview`} · {formatStartTimeET(p.startTimeUTC)}
        </span>
        <div aria-hidden="true" style={{ display: "flex", alignItems: "center", gap: 14, margin: "0 0 .6rem" }}>
          <TeamLogo abbrev={p.away.abbrev} size={56} gap={0} />
          <span style={{ fontFamily: "var(--font-display)", fontSize: "1.1rem", color: "var(--text-secondary)" }}>at</span>
          <TeamLogo abbrev={p.home.abbrev} size={56} gap={0} />
        </div>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(2.2rem,5vw,3.6rem)", lineHeight: 0.96, textTransform: "uppercase", margin: "0 0 .8rem" }}>
          <TeamLink abbrev={p.away.abbrev}>{p.away.name}</TeamLink> at <TeamLink abbrev={p.home.abbrev}>{p.home.name}</TeamLink>
        </h1>
        <p style={{ margin: 0, color: "var(--text-primary)" }}>
          {p.venue}
          {p.tv.length > 0 && (
            <>
              {" "}
              · <span style={{ color: "var(--gold)", fontWeight: 600 }}>{p.tv.join(", ")}</span>
            </>
          )}
        </p>
        {/* Replaces the static score with a self-updating one once the game starts. */}
        <LiveScoreboard gameId={p.id} startTimeUTC={p.startTimeUTC} title={`${p.away.name} at ${p.home.name}`} variant="page">
          {(live || final) && p.away.score != null && p.home.score != null && (
            <p style={{ margin: ".8rem 0 0", fontFamily: "var(--font-display)", fontSize: "2rem" }}>
              {p.away.abbrev} {p.away.score} · {p.home.abbrev} {p.home.score}
              <a href={`https://www.nhl.com/gamecenter/${p.id}`} style={{ marginLeft: 14, fontFamily: "var(--font-body)", fontSize: ".85rem", color: "var(--gold)", textDecoration: "none" }}>
                NHL.com game center ↗
              </a>
            </p>
          )}
        </LiveScoreboard>
      </section>

      {p.odds && !(p.state === "LIVE" || p.state === "CRIT" || p.state === "OVER" || p.state === "FINAL" || p.state === "OFF") && (
        <EloOddsBar odds={p.odds} away={{ abbrev: p.away.abbrev, name: p.away.name }} home={{ abbrev: p.home.abbrev, name: p.home.name }} />
      )}

      {/* Tale of the tape */}
      {(p.away.stats.length > 0 || p.home.stats.length > 0) && (
        <section style={{ marginBottom: "2.25rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <h2 style={H2}>Tale of the Tape</h2>
            <span style={{ fontSize: ".78rem", color: "var(--text-secondary)" }}>{p.statsSeasonLabel} · league rank</span>
          </div>
          <div style={CARD}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", ...LABEL, marginBottom: 6 }}>
              <TeamLink abbrev={p.away.abbrev}>
                <TeamLogo abbrev={p.away.abbrev} size={18} gap={4} />
                {p.away.abbrev}
              </TeamLink>
              <span />
              <TeamLink abbrev={p.home.abbrev} style={{ textAlign: "right" }}>
                <TeamLogo abbrev={p.home.abbrev} size={18} gap={4} />
                {p.home.abbrev}
              </TeamLink>
            </div>
            {p.away.stats.map((s, i) => {
              const h = p.home.stats[i];
              return (
                <div key={s.label} style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--border)", fontVariantNumeric: "tabular-nums" }}>
                  <span>
                    <strong>{s.value}</strong> <span className="tape-rank" style={{ fontSize: ".75rem", color: "var(--text-secondary)" }}>{s.rank}</span>
                  </span>
                  <span style={{ fontSize: ".78rem", color: "var(--text-secondary)", padding: "0 10px", textAlign: "center" }}>{s.label}</span>
                  <span style={{ textAlign: "right" }} className="tape-right">
                    <span className="tape-rank" style={{ fontSize: ".75rem", color: "var(--text-secondary)" }}>{h?.rank}</span> <strong>{h?.value}</strong>
                  </span>
                </div>
              );
            })}
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "10px 0 2px", borderTop: "1px solid var(--border)" }}>
              <FormBars results={p.away.form} />
              <span style={{ fontSize: ".78rem", color: "var(--text-secondary)", padding: "0 10px" }}>Last 5</span>
              <span style={{ justifySelf: "end" }}>
                <FormBars results={p.home.form} />
              </span>
            </div>
          </div>
        </section>
      )}

      {/* Players */}
      <section style={{ marginBottom: "2.25rem" }}>
        <h2 style={H2}>Who to Watch</h2>
        <div className="card-row" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", alignItems: "start" }}>
          <TeamPlayers t={p.away} />
          <TeamPlayers t={p.home} />
        </div>
        <p style={{ fontSize: ".72rem", color: "var(--text-muted)", marginTop: 8 }}>
          Current NHL rosters, with each player&apos;s most recent regular season on file. Starting goalies aren&apos;t announced until close to puck drop.
        </p>
      </section>

      {askQuestions.length > 0 && (
        <section style={{ marginBottom: "2.25rem" }}>
          <AskAboutGame title="Ask about this matchup" questions={askQuestions} />
        </section>
      )}

      {/* Head to head */}
      {p.meetings.length > 0 && (
        <section style={{ marginBottom: "2.25rem" }}>
          <h2 style={H2}>Last {p.meetings.length} Meeting{p.meetings.length === 1 ? "" : "s"}</h2>
          <div style={{ ...CARD, padding: "0 1.3rem" }}>
            {p.meetings.map((m, i) => {
              const awayWon = m.awayScore > m.homeScore;
              return (
                <Link
                  key={m.id}
                  href={`/games/${m.id}`}
                  style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: i ? "1px solid var(--border)" : "none", textDecoration: "none", color: "var(--text-secondary)", fontSize: ".9rem" }}
                >
                  <span>
                    {formatGameDate(m.date, true)}
                    {m.gameType === "playoff" ? " · playoffs" : ""}
                  </span>
                  <span style={{ color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
                    <span style={{ fontWeight: awayWon ? 700 : 400 }}>
                      <TeamLogo abbrev={m.awayAbbrev} size={18} gap={3} />
                      {m.awayAbbrev} {m.awayScore}
                    </span>{" "}
                    @{" "}
                    <span style={{ fontWeight: awayWon ? 400 : 700 }}>
                      <TeamLogo abbrev={m.homeAbbrev} size={18} gap={3} />
                      {m.homeAbbrev} {m.homeScore}
                    </span>
                    {m.endType !== "regulation" ? ` (${m.endType === "overtime" ? "OT" : "SO"})` : ""}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}

function TeamPlayers({ t }: { t: PreviewTeam }) {
  return (
    <div style={CARD}>
      <div style={{ ...LABEL, color: "var(--text-primary)", marginBottom: 8 }}>
        <TeamLink abbrev={t.abbrev}>{t.fullName}</TeamLink>
      </div>
      {t.milestonesTonight.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ ...LABEL, color: "var(--gold)" }}>Within reach tonight</div>
          {t.milestonesTonight.map((m) => (
            <div key={`${m.playerId}-${m.category}`} style={{ fontSize: ".88rem", padding: "3px 0" }}>
              <Link href={`/players/${m.playerId}`} style={{ color: "var(--text-primary)", fontWeight: 600, textDecoration: "none" }}>
                {m.playerName}
              </Link>{" "}
              <span style={{ color: "var(--text-secondary)" }}>{milestoneText(m)}</span>
            </div>
          ))}
        </div>
      )}
      {t.streaks.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ ...LABEL, color: "var(--gold)" }}>Point streaks</div>
          {t.streaks.map((s) => (
            <div key={s.id} style={{ fontSize: ".88rem", padding: "3px 0" }}>
              <Link href={`/players/${s.id}`} style={{ color: "var(--text-primary)", fontWeight: 600, textDecoration: "none" }}>
                {s.name}
              </Link>{" "}
              <span style={{ color: "var(--text-secondary)" }}>{s.games} straight games</span>
            </div>
          ))}
        </div>
      )}
      <div style={LABEL}>Top scorers</div>
      {t.topSkaters.map((s) => (
        <div key={s.id} style={{ fontSize: ".88rem", padding: "4px 0" }}>
          <Link href={`/players/${s.id}`} style={{ color: "var(--text-primary)", fontWeight: 600, textDecoration: "none" }}>
            {s.name}
          </Link>
          <div style={{ fontSize: ".78rem", color: "var(--text-secondary)" }}>{s.line}</div>
        </div>
      ))}
      <div style={{ ...LABEL, marginTop: 10 }}>Goalies</div>
      {t.goalies.map((g) => (
        <div key={g.id} style={{ fontSize: ".88rem", padding: "4px 0" }}>
          {g.line ? (
            <Link href={`/players/${g.id}`} style={{ color: "var(--text-primary)", fontWeight: 600, textDecoration: "none" }}>
              {g.name}
            </Link>
          ) : (
            <span style={{ fontWeight: 600 }}>{g.name}</span>
          )}
          <div style={{ fontSize: ".78rem", color: "var(--text-secondary)" }}>{g.line ?? "No NHL games on file"}</div>
        </div>
      ))}
    </div>
  );
}
