// Grudge Index (spec section 9): every heat event from the history tables
// (nhl_games, nhl_penalty_events, nhl_goal_events, nhl_standings), heat for
// every franchise pair at every month-end since 1917, its 0-100 percentile
// index, and the current reading with its top reasons. Rebuilds from
// scratch; idempotent. Weights: config/stats.ts (GRUDGE).
//
// Usage: npx tsx --env-file=.env.local scripts/stats/build-grudge.ts

import { Client } from "pg";
import { ELO, GRUDGE, type GrudgeEventType } from "../../config/stats";
import { HeatAccumulator, monthEnds, heatIndex, eventHeat, type GrudgeEvent } from "../../lib/stats/grudge";

const YEAR = 365.25;
const fmtDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const seasonEnd = (season: string) => season.slice(4); // "19781979" -> "1979"
// The NHL's infraction codes, as words ("match-penatly-10-minutes" is the
// feed's own spelling).
const ejectionLabel = (code: string) =>
  /match/.test(code) ? "Match penalty" : code === "gross-misconduct" ? "Gross misconduct" : code === "game-misconduct-head-coach" ? "Game misconduct (coach)" : "Game misconduct";

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows as T[];

  const teams = new Map((await q<{ id: number; lineage_id: number; full_name: string }>(`select id, lineage_id, full_name from nhl_teams`)).map((t) => [Number(t.id), t]));
  const lineage = (teamId: number) => Number(teams.get(teamId)!.lineage_id);
  const tname = (teamId: number) => teams.get(teamId)!.full_name;

  const events: GrudgeEvent[] = [];
  const add = (type: GrudgeEventType, from: number, to: number, date: string, reason: string, gameId: number | null, units = 1) => {
    if (from === to || units <= 0) return;
    const e = GRUDGE.events[type];
    events.push({ from, to, date, type, weight: e.weight * units, halfLifeDays: e.halfLifeYears * YEAR, reason, gameId });
  };

  // Games (real results only).
  type G = { id: number; season: string; game_type: string; game_date: string; home_team_id: number; away_team_id: number; home_score: number; away_score: number; final_state: string };
  const games = (await q<G>(
    `select id, season, game_type, to_char(game_date, 'YYYY-MM-DD') game_date, home_team_id, away_team_id, home_score, away_score, final_state
     from nhl_games where not (id = any($1::int[])) order by game_date, id`,
    [ELO.excludeGameIds],
  )).map((g) => ({ ...g, id: Number(g.id), home_team_id: Number(g.home_team_id), away_team_id: Number(g.away_team_id) }));
  const byId = new Map(games.map((g) => [g.id, g]));

  // 1. Playoff series (round and series from the game id, as qa.playoff_series).
  const series = new Map<string, G[]>();
  for (const g of games) {
    if (g.game_type !== "playoff") continue;
    const round = Math.floor(g.id / 100) % 10, ser = Math.floor(g.id / 10) % 10;
    if (round === 0) continue; // 2020 qualifying round-robin
    const k = `${g.season}-${round}-${ser}`;
    if (!series.has(k)) series.set(k, []);
    series.get(k)!.push(g);
  }
  for (const [k, gs] of series) {
    const round = k.split("-")[1];
    const a = gs[0].home_team_id, b = gs[0].away_team_id;
    let aw = 0, bw = 0, ag = 0, bg = 0;
    for (const g of gs) {
      const aHome = g.home_team_id === a;
      const [as, bs] = aHome ? [g.home_score, g.away_score] : [g.away_score, g.home_score];
      ag += as; bg += bs;
      if (as > bs) aw++; else if (bs > as) bw++;
    }
    const winner = aw > bw || (aw === bw && ag > bg) ? a : b, loser = winner === a ? b : a;
    const date = gs.reduce((m, g) => (g.game_date > m ? g.game_date : m), gs[0].game_date);
    const label = `${seasonEnd(gs[0].season)} Round ${round}`;
    const result = `${tname(winner)} won ${Math.max(aw, bw)}-${Math.min(aw, bw)}`;
    const [fa, fb] = [lineage(a), lineage(b)];
    add("playoffSeries", fa, fb, date, `Playoff series, ${label} (${result})`, null);
    add("playoffSeries", fb, fa, date, `Playoff series, ${label} (${result})`, null);
    add("eliminated", lineage(loser), lineage(winner), date, `Eliminated by the ${tname(winner)}, ${label}`, null);
    if (gs.length === 7) {
      add("gameSeven", fa, fb, date, `Game 7, ${label}`, null);
      add("gameSeven", fb, fa, date, `Game 7, ${label}`, null);
    }
  }

  // 2. Head-to-head games: meetings, close games, penalties, blown leads.
  const pim = new Map((await q<{ game_id: number; pim: number; fights: number }>(
    `select game_id, sum(minutes)::int pim, count(*) filter (where infraction = 'fighting')::int fights from nhl_penalty_events group by game_id`,
  )).map((r) => [Number(r.game_id), r]));
  const seasonPim = new Map<string, number>();
  {
    const tot = new Map<string, { s: number; n: number }>();
    for (const g of games) {
      const t = tot.get(g.season) ?? { s: 0, n: 0 };
      t.s += pim.get(g.id)?.pim ?? 0; t.n++;
      tot.set(g.season, t);
    }
    for (const [s, t] of tot) seasonPim.set(s, t.s / t.n);
  }
  const ejections = await q<{ game_id: number; team_id: number; infraction: string; player: string | null }>(
    `select p.game_id, p.team_id, p.infraction, pl.full_name player from nhl_penalty_events p left join nhl_players pl on pl.id = p.player_id
     where p.type_code in ('GAM', 'MAT', 'GRO')`,
  );
  const goals = new Map<number, { team: number; t: number }[]>();
  for (const r of await q<{ game_id: number; team_id: number; time_elapsed_sec: number }>(
    `select game_id, team_id, time_elapsed_sec from nhl_goal_events where coalesce(period_type, '') <> 'SO' order by game_id, time_elapsed_sec, event_id`,
  )) {
    const id = Number(r.game_id);
    if (!goals.has(id)) goals.set(id, []);
    goals.get(id)!.push({ team: Number(r.team_id), t: r.time_elapsed_sec });
  }

  for (const g of games) {
    const fh = lineage(g.home_team_id), fa = lineage(g.away_team_id);
    if (fh === fa) continue;
    const date = g.game_date, when = fmtDate(date);
    const score = `${tname(g.away_team_id)} ${g.away_score}, ${tname(g.home_team_id)} ${g.home_score}`;
    if (g.game_type === "regular") {
      add("regularMeeting", fh, fa, date, `Met on ${when}`, g.id);
      add("regularMeeting", fa, fh, date, `Met on ${when}`, g.id);
    }
    const margin = Math.abs(g.home_score - g.away_score);
    if (margin <= 1 || g.final_state === "OT" || g.final_state === "SO") {
      const what = g.final_state === "SO" ? "Shootout" : g.final_state === "OT" ? "Overtime" : margin === 0 ? "Tie" : "One-goal game";
      add("closeGame", fh, fa, date, `${what}, ${when} (${score})`, g.id);
      add("closeGame", fa, fh, date, `${what}, ${when} (${score})`, g.id);
    }
    const p = pim.get(g.id);
    if (p) {
      const excess = p.pim - (seasonPim.get(g.season) ?? 0);
      if (excess > 0) {
        add("excessPim", fh, fa, date, `${p.pim} penalty minutes, ${when}`, g.id, excess);
        add("excessPim", fa, fh, date, `${p.pim} penalty minutes, ${when}`, g.id, excess);
      }
      const fights = Math.ceil(p.fights / 2);
      if (fights > 0) {
        const txt = `${fights} fight${fights > 1 ? "s" : ""}, ${when}`;
        add("fight", fh, fa, date, txt, g.id, fights);
        add("fight", fa, fh, date, txt, g.id, fights);
      }
    }
    // Blown 3+ goal leads (the game was lost) and the comebacks behind them.
    const gl = goals.get(g.id);
    if (gl && g.home_score !== g.away_score) {
      let h = 0, a = 0, maxHomeLead = 0, maxAwayLead = 0;
      for (const x of gl) {
        if (x.team === g.home_team_id) h++; else if (x.team === g.away_team_id) a++;
        maxHomeLead = Math.max(maxHomeLead, h - a);
        maxAwayLead = Math.max(maxAwayLead, a - h);
      }
      const homeWon = g.home_score > g.away_score;
      const loserLead = homeWon ? maxAwayLead : maxHomeLead;
      if (loserLead >= GRUDGE.blownLeadGoals) {
        const [w, l] = homeWon ? [g.home_team_id, g.away_team_id] : [g.away_team_id, g.home_team_id];
        const final = `${Math.max(g.home_score, g.away_score)}-${Math.min(g.home_score, g.away_score)}`;
        add("blownLead", lineage(l), lineage(w), date, `Blew a ${loserLead}-goal lead and lost ${final}, ${when}`, g.id);
        add("comebackLoser", lineage(l), lineage(w), date, `Lost ${final} after leading by ${loserLead}, ${when}`, g.id);
        add("comebackWinner", lineage(w), lineage(l), date, `Came back from ${loserLead} goals down to win ${final}, ${when}`, g.id);
      }
    }
  }
  for (const e of ejections) {
    const g = byId.get(Number(e.game_id));
    if (!g) continue;
    const penalized = Number(e.team_id);
    const wronged = penalized === g.home_team_id ? g.away_team_id : g.home_team_id;
    add("ejection", lineage(wronged), lineage(penalized), g.game_date, `${ejectionLabel(e.infraction)}${e.player ? ` for ${e.player}` : ""}, ${fmtDate(g.game_date)}`, g.id);
  }

  // 3. Same division, once a season (from each team's last standings row).
  const divs = await q<{ season: string; team_id: number; division: string; last: string }>(
    `select distinct on (season, team_id) season, team_id, division, to_char(date, 'YYYY-MM-DD') last from nhl_standings
     where division is not null order by season, team_id, date desc`,
  );
  const bySeasonDiv = new Map<string, { team: number; last: string }[]>();
  for (const d of divs) {
    const k = `${d.season}|${d.division}`;
    if (!bySeasonDiv.has(k)) bySeasonDiv.set(k, []);
    bySeasonDiv.get(k)!.push({ team: Number(d.team_id), last: d.last });
  }
  for (const [k, ts] of bySeasonDiv) {
    const [season, division] = k.split("|");
    const date = ts.reduce((m, t) => (t.last > m ? t.last : m), ts[0].last);
    for (const x of ts) for (const y of ts) {
      if (x.team === y.team) continue;
      add("sameDivision", lineage(x.team), lineage(y.team), date, `Same division (${division}), ${seasonEnd(season)}`, null);
    }
  }
  events.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  console.log(`${events.length} events (${Object.entries(events.reduce((m, e) => ((m[e.type] = (m[e.type] ?? 0) + 1), m), {} as Record<string, number>)).map(([k, v]) => `${k} ${v}`).join(", ")}).`);

  // 4. Heat at every month-end, for pairs whose franchises both existed:
  // from a franchise's first game to six months after its last (from the
  // games themselves; nhl_franchises ends Arizona's line in 2023-24 though
  // Utah's games continue it).
  const today = new Date().toISOString().slice(0, 10);
  const months = monthEnds(events[0].date, today);
  const span = new Map<number, { first: string; last: string }>();
  for (const g of games) for (const t of [g.home_team_id, g.away_team_id]) {
    const f = lineage(t), x = span.get(f);
    if (!x) span.set(f, { first: g.game_date, last: g.game_date });
    else x.last = g.game_date > x.last ? g.game_date : x.last;
  }
  const plus6 = (d: string) => new Date(Date.parse(d) + 183 * 86_400_000).toISOString().slice(0, 10);
  const active = (fid: number, on: string) => {
    const x = span.get(fid);
    return !!x && x.first <= on && on <= plus6(x.last);
  };
  const acc = new Map<string, HeatAccumulator>();
  const monthly: { from: number; to: number; month: string; heat: number }[] = [];
  let i = 0;
  for (const month of months) {
    for (; i < events.length && events[i].date <= month; i++) {
      const e = events[i];
      const k = `${e.from}:${e.to}`;
      if (!acc.has(k)) acc.set(k, new HeatAccumulator());
      const a = acc.get(k)!;
      a.advance(e.date);
      a.add(e);
    }
    for (const [k, a] of acc) {
      const [from, to] = k.split(":").map(Number);
      if (!active(from, month) || !active(to, month)) continue;
      a.advance(month);
      monthly.push({ from, to, month, heat: a.heat() });
    }
  }
  const maxHeat = monthly.reduce((m, x) => Math.max(m, x.heat), 0);
  console.log(`${monthly.length} pair-months, ${months[0]} to ${months.at(-1)}.`);

  // 5. Write.
  await db.query("begin");
  await db.query("truncate grudge_events, grudge_monthly, grudge_current");
  const insert = async (table: string, cols: string[], rows: unknown[][]) => {
    for (let s = 0; s < rows.length; s += 2000) {
      const chunk = rows.slice(s, s + 2000);
      const params: unknown[] = [];
      const values = chunk.map((r) => `(${r.map((v) => `$${params.push(v)}`).join(",")})`).join(",");
      await db.query(`insert into ${table} (${cols.join(",")}) values ${values}`, params);
    }
  };
  await insert("grudge_events", ["franchise_from", "franchise_to", "date", "type", "weight", "half_life_days", "reason_text", "game_id", "model_version"],
    events.map((e) => [e.from, e.to, e.date, e.type, e.weight, e.halfLifeDays, e.reason, e.gameId, GRUDGE.modelVersion]));
  await insert("grudge_monthly", ["franchise_from", "franchise_to", "month", "raw_heat", "index_0_100"],
    monthly.map((m) => [m.from, m.to, m.month, m.heat, heatIndex(m.heat, maxHeat)]));

  // Current: heat today for active pairs, top 3 reasons, peak month.
  const peak = new Map<string, { index: number; month: string }>();
  for (const m of monthly) {
    const k = `${m.from}:${m.to}`, idx = heatIndex(m.heat, maxHeat);
    if (!peak.has(k) || idx > peak.get(k)!.index) peak.set(k, { index: idx, month: m.month });
  }
  const byPair = new Map<string, GrudgeEvent[]>();
  for (const e of events) {
    const k = `${e.from}:${e.to}`;
    if (!byPair.has(k)) byPair.set(k, []);
    byPair.get(k)!.push(e);
  }
  const current: unknown[][] = [];
  for (const [k, es] of byPair) {
    const [from, to] = k.split(":").map(Number);
    if (!active(from, today) || !active(to, today)) continue;
    const contrib = es.map((e) => ({ e, h: eventHeat(e, today) })).filter((x) => x.h > 0);
    const heat = contrib.reduce((s, x) => s + x.h, 0);
    const top = contrib.sort((x, y) => y.h - x.h).slice(0, 3).map((x) => ({ text: x.e.reason, type: x.e.type, date: x.e.date, heat: Math.round(x.h * 100) / 100 }));
    const pk = peak.get(k);
    current.push([from, to, heat, heatIndex(heat, maxHeat), JSON.stringify(top), pk?.index ?? 0, pk?.month ?? null, GRUDGE.modelVersion]);
  }
  await insert("grudge_current", ["franchise_from", "franchise_to", "raw_heat", "index_0_100", "top_reasons", "peak_index", "peak_month", "model_version"], current);
  await db.query("commit");
  console.log(`Stored ${events.length} events, ${monthly.length} monthly readings, ${current.length} current pairs.`);
  await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
