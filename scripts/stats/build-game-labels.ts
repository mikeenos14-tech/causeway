// Names every structurally notable game in NHL history (game_labels), so
// the Doppelganger card can name its twin even when it isn't curated:
// Cup clinchers, Game 7s, series-ending and long overtime games, big
// comebacks and blown leads, milestone and 50th goals, and the most
// penalty-filled nights. Every label is computed from the loaded history,
// so it can only say what the data shows. Rebuilt from scratch each run.
//
// Usage: npx tsx --env-file=.env.local scripts/stats/build-game-labels.ts [--dry-run]

import { Client } from "pg";

type G = { id: number; season: string; game_type: string; game_date: string; home: number; away: number; hs: number; as: number; final_state: string; ot_periods: number; home_code: string; away_code: string };
type Label = { game_id: number; kind: string; label: string; fame_points: number };

const yearOf = (season: string) => season.slice(4); // the playoff/spring year
const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? "th"}`;
const NHL_OWNS_CUP_FROM = "19261927"; // before this, the NHL champion played another league for the Cup

function scoreline(g: G): string {
  const homeWon = g.hs > g.as;
  const [wc, w, l, lc] = homeWon ? [g.home_code, g.hs, g.as, g.away_code] : [g.away_code, g.as, g.hs, g.home_code];
  const tail = g.final_state === "OT" ? (g.ot_periods > 1 ? `, ${g.ot_periods}OT` : ", OT") : g.final_state === "SO" ? ", SO" : "";
  return g.hs === g.as ? `${g.away_code} ${g.as}-${g.hs} ${g.home_code}, tie` : `${wc} ${w}-${l} ${lc}${tail}`;
}

// Playoff ids: SSSS 03 0 R S G (round, series, game).
const series = (id: number) => ({ round: Math.floor(id / 100) % 10, series: Math.floor(id / 10) % 10, game: id % 10 });

async function main() {
  const dry = process.argv.includes("--dry-run");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const { rows: games } = await client.query<G>(
    `select g.id, g.season, g.game_type, g.game_date::text, g.home_team_id as home, g.away_team_id as away, g.home_score as hs, g.away_score as "as",
            g.final_state, g.ot_periods, ht.tri_code as home_code, at.tri_code as away_code
     from nhl_games g join nhl_teams ht on ht.id = g.home_team_id join nhl_teams at on at.id = g.away_team_id order by g.id`,
  );
  const byId = new Map(games.map((g) => [g.id, g]));
  const labels: Label[] = [];
  const add = (g: G, kind: string, label: string, fame: number) => labels.push({ game_id: g.id, kind, label, fame_points: fame });

  // ---- Playoff structure ----
  const playoff = games.filter((g) => g.game_type === "playoff");
  const seriesKey = (g: G) => `${g.season}-${series(g.id).round}-${series(g.id).series}`;
  const bySeries = new Map<string, G[]>();
  for (const g of playoff) bySeries.set(seriesKey(g), [...(bySeries.get(seriesKey(g)) ?? []), g]);
  const finalRound = new Map<string, number>();
  for (const g of playoff) finalRound.set(g.season, Math.max(finalRound.get(g.season) ?? 0, series(g.id).round));

  for (const [, sg] of bySeries) {
    sg.sort((a, b) => a.id - b.id);
    const last = sg.at(-1)!;
    const winnerOf = (g: G) => (g.hs > g.as ? g.home : g.as > g.hs ? g.away : null);
    const wins = new Map<number, number>();
    for (const g of sg) {
      const w = winnerOf(g);
      if (w) wins.set(w, (wins.get(w) ?? 0) + 1);
    }
    const lastWinner = winnerOf(last);
    // A clincher only when the last game's winner also won the series on
    // games (skips early total-goals series, where it may not have).
    const clinched = lastWinner != null && (wins.get(lastWinner) ?? 0) > Math.max(0, ...[...wins].filter(([t]) => t !== lastWinner).map(([, n]) => n));
    const { round } = series(last.id);
    const isFinal = round === finalRound.get(last.season);
    const year = yearOf(last.season);
    if (clinched && isFinal && last.season >= NHL_OWNS_CUP_FROM) add(last, "cup_clincher", `${year} Stanley Cup clincher: ${scoreline(last)}`, 6);
    if (clinched && last.final_state === "OT") add(last, "series_clincher_ot", `${year} ${isFinal ? "Final" : `Round ${round}`}, Game ${series(last.id).game}: series ends in overtime, ${scoreline(last)}`, 5);
  }
  for (const g of playoff) {
    const { round, game } = series(g.id);
    const stage = round === finalRound.get(g.season) ? "Final" : `Round ${round}`;
    if (game === 7) add(g, "game7", `${yearOf(g.season)} ${stage}, Game 7: ${scoreline(g)}`, 5);
    if (g.final_state === "OT" && g.ot_periods >= 3) add(g, "long_ot", `${yearOf(g.season)} ${stage}, Game ${game}: ${ordinal(g.ot_periods)} overtime, ${scoreline(g)}`, 4);
    else if (g.final_state === "OT") add(g, "playoff_ot", `${yearOf(g.season)} ${stage}, Game ${game}: ${scoreline(g)}`, 2);
  }

  // ---- Comebacks and blown leads, from the goal sequence ----
  const { rows: goals } = await client.query(
    `select e.game_id, e.team_id, e.scorer_id, e.period, e.time_in_period_sec, g.game_date::text as game_date, g.game_type, g.season
     from nhl_goal_events e join nhl_games g on g.id = e.game_id
     order by e.game_id, e.period, e.time_in_period_sec, e.event_id`,
  );
  const goalsByGame = new Map<number, typeof goals>();
  for (const r of goals) goalsByGame.set(r.game_id, [...(goalsByGame.get(r.game_id) ?? []), r]);
  for (const [gameId, gs] of goalsByGame) {
    const g = byId.get(gameId)!;
    if (g.hs === g.as) continue;
    let h = 0;
    let a = 0;
    let maxHomeLead = 0;
    let maxAwayLead = 0;
    for (const x of gs) {
      if (x.team_id === g.home) h++;
      else a++;
      maxHomeLead = Math.max(maxHomeLead, h - a);
      maxAwayLead = Math.max(maxAwayLead, a - h);
    }
    const homeWon = g.hs > g.as;
    const overcome = homeWon ? maxAwayLead : maxHomeLead; // the winner's largest deficit
    const threshold = g.game_type === "playoff" ? 3 : 4;
    if (overcome >= threshold) {
      const [winner, loser] = homeWon ? [g.home_code, g.away_code] : [g.away_code, g.home_code];
      const when = g.game_type === "playoff" ? `${yearOf(g.season)} playoffs` : g.game_date;
      add(g, "comeback", `${winner} erases a ${overcome}-goal deficit against ${loser}, ${when}: ${scoreline(g)}`, 1 + overcome);
      add(g, "blown_lead", `${loser} blows a ${overcome}-goal lead against ${winner}, ${when}: ${scoreline(g)}`, 1 + overcome);
    }
  }

  // ---- Milestone and 50th goals (regular season, by NHL convention) ----
  const { rows: names } = await client.query(`select id, full_name from nhl_players`);
  const nameOf = new Map(names.map((r) => [Number(r.id), r.full_name as string]));
  const career = new Map<number, number>();
  const seasonGoals = new Map<string, number>();
  const regular = goals.filter((r) => r.game_type === "regular" && r.scorer_id).sort((x, y) => x.game_date.localeCompare(y.game_date) || x.game_id - y.game_id || x.period - y.period || x.time_in_period_sec - y.time_in_period_sec);
  for (const r of regular) {
    const n = (career.get(r.scorer_id) ?? 0) + 1;
    career.set(r.scorer_id, n);
    const key = `${r.scorer_id}-${r.season}`;
    const s = (seasonGoals.get(key) ?? 0) + 1;
    seasonGoals.set(key, s);
    const who = nameOf.get(Number(r.scorer_id)) ?? "Unknown player";
    const g = byId.get(r.game_id)!;
    if (n >= 500 && n % 100 === 0) add(g, "milestone_goal", `${who}'s ${ordinal(n)} career goal, ${r.game_date}: ${scoreline(g)}`, 3);
    if (s === 50) add(g, "fifty_goal", `${who}'s 50th goal of ${r.season.slice(0, 4)}-${r.season.slice(6)}, ${r.game_date}`, 2);
  }

  // ---- Penalty-filled nights: each season's three highest-PIM games ----
  const { rows: pim } = await client.query(
    `select game_id, pim from (
       select p.game_id, g.season, sum(p.minutes)::int as pim, row_number() over (partition by g.season order by sum(p.minutes) desc) as rk
       from nhl_penalty_events p join nhl_games g on g.id = p.game_id group by p.game_id, g.season) x
     where rk <= 3 and pim > 0`,
  );
  for (const r of pim) {
    const g = byId.get(r.game_id)!;
    add(g, "penalty_night", `${r.pim} penalty minutes, ${g.game_date}: ${scoreline(g)}`, 2);
  }

  // ---- Report and store ----
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l.kind, (counts.get(l.kind) ?? 0) + 1);
  console.log(`${labels.length} labels on ${new Set(labels.map((l) => l.game_id)).size} games:`);
  console.table(Object.fromEntries(counts));
  const bos = labels.filter((l) => {
    const g = byId.get(l.game_id)!;
    return g.home_code === "BOS" || g.away_code === "BOS";
  });
  console.log(`Bruins games labeled: ${new Set(bos.map((l) => l.game_id)).size}`);

  if (!dry) {
    await client.query("begin");
    await client.query("delete from game_labels");
    for (let i = 0; i < labels.length; i += 5000) {
      const chunk = labels.slice(i, i + 5000);
      const values = chunk.map((_, r) => `($${r * 4 + 1},$${r * 4 + 2},$${r * 4 + 3},$${r * 4 + 4})`).join(",");
      await client.query(`insert into game_labels (game_id, kind, label, fame_points) values ${values} on conflict do nothing`, chunk.flatMap((l) => [l.game_id, l.kind, l.label, l.fame_points]));
    }
    await client.query("commit");
    console.log("Stored.");
  }
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
