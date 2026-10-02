// Every player page's career totals against the NHL's official career
// totals (stats API, all seasons aggregated), regular season and playoffs:
// what the page shows (lib/player-detail-data.ts) must equal the NHL.
// Skaters: GP, goals, assists, points, and from the season table PIM,
// plus-minus and shots. Goalies: GP, wins, losses, OT losses, ties,
// shutouts, save percentage.
//
// Usage: npx tsx --env-file=.env.local scripts/qa/check-player-careers.ts [--only-pre2007]
// Run when no games are in progress (live games make the two sides differ).

import { pool } from "../../lib/db";
import { getSkaterCareerTotals, getGoalieCareerTotals, getSkaterSeasonSplits, getGoalieSeasonSplits } from "../../lib/player-detail-data";

type Row = Record<string, number | string | null>;

async function nhlCareers(kind: "skater" | "goalie", gameTypeId: 2 | 3): Promise<Map<number, Row>> {
  const out = new Map<number, Row>();
  const exp = encodeURIComponent(`gameTypeId=${gameTypeId} and seasonId>=19171918 and seasonId<=20262027`);
  const sort = encodeURIComponent(JSON.stringify([{ property: "playerId", direction: "ASC" }]));
  for (let start = 0; ; start += 100) {
    const url = `https://api.nhle.com/stats/rest/en/${kind}/summary?isAggregate=true&isGame=false&start=${start}&limit=100&sort=${sort}&cayenneExp=${exp}`;
    let body: { data: Row[]; total: number } | null = null;
    for (let attempt = 0; attempt < 4 && !body; attempt++) {
      const res = await fetch(url);
      if (res.ok) body = await res.json();
      else await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
    if (!body) throw new Error(`NHL stats API failed: ${url}`);
    for (const r of body.data) out.set(Number(r.playerId), r);
    if (start + 100 >= body.total) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return out;
}

(async () => {
  const onlyPre = process.argv.includes("--only-pre2007");
  const [skR, skP, gkR, gkP] = [await nhlCareers("skater", 2), await nhlCareers("skater", 3), await nhlCareers("goalie", 2), await nhlCareers("goalie", 3)];
  console.log(`NHL careers: ${skR.size} skaters, ${gkR.size} goalies.`);
  const { rows: players } = await pool.query(
    `select p.id, p.full_name, p.position = 'G' as goalie,
            exists (select 1 from nhl_skater_games s join nhl_games g on g.id = s.game_id where s.player_id = p.id and s.played and g.season < '20072008')
            or exists (select 1 from nhl_goalie_games x join nhl_games g on g.id = x.game_id where x.player_id = p.id and g.season < '20072008') as pre2007
     from players p order by p.id`,
  );
  const todo = players.filter((p) => !onlyPre || p.pre2007);
  let checked = 0, notInNhl = 0;
  const bad: string[] = [];
  const pre = { n: 0, bad: 0 };
  for (const p of todo) {
    const nhlReg = (p.goalie ? gkR : skR).get(p.id);
    const nhlPo = (p.goalie ? gkP : skP).get(p.id);
    if (!nhlReg && !nhlPo) {
      notInNhl++;
      continue;
    }
    checked++;
    if (p.pre2007) pre.n++;
    const diffs: string[] = [];
    const cmp = (label: string, ours: unknown, theirs: unknown) => {
      const a = ours == null ? 0 : Number(ours), b = theirs == null ? 0 : Number(theirs);
      if (Math.abs(a - b) > (label.includes("sv%") ? 0.0011 : 0)) diffs.push(`${label} ${a} vs NHL ${b}`);
    };
    for (const [gt, nhl] of [["regular", nhlReg], ["playoff", nhlPo]] as const) {
      if (p.goalie) {
        const t = await getGoalieCareerTotals(p.id, gt);
        if (!nhl) {
          if (t.games > 0) diffs.push(`${gt}: ${t.games} GP here, none at the NHL`);
          continue;
        }
        cmp(`${gt} GP`, t.games, nhl.gamesPlayed);
        cmp(`${gt} W`, t.wins, nhl.wins);
        cmp(`${gt} L`, t.losses, nhl.losses);
        cmp(`${gt} OTL`, t.otl, nhl.otLosses);
        cmp(`${gt} T`, t.ties, nhl.ties);
        cmp(`${gt} SO`, t.shutouts, nhl.shutouts);
        if (nhl.savePct != null && t.save_pct != null) cmp(`${gt} sv%`, t.save_pct, nhl.savePct);
      } else {
        const t = await getSkaterCareerTotals(p.id, gt);
        if (!nhl) {
          if (t.games > 0) diffs.push(`${gt}: ${t.games} GP here, none at the NHL`);
          continue;
        }
        cmp(`${gt} GP`, t.games, nhl.gamesPlayed);
        cmp(`${gt} G`, t.goals, nhl.goals);
        cmp(`${gt} A`, t.assists, nhl.assists);
        cmp(`${gt} P`, t.points, nhl.points);
        if (gt === "regular") {
          const splits = await getSkaterSeasonSplits(p.id);
          const sum = (k: "pim" | "plus_minus" | "shots") => splits.reduce((s, r) => s + Number(r[k] ?? 0), 0);
          cmp("PIM", sum("pim"), nhl.penaltyMinutes);
          if (splits.every((r) => r.plus_minus != null)) cmp("+/-", sum("plus_minus"), nhl.plusMinus);
          if (splits.every((r) => r.shots != null)) cmp("shots", sum("shots"), nhl.shots);
        }
      }
    }
    if (p.goalie) {
      const splits = await getGoalieSeasonSplits(p.id);
      cmp("season-table GP", splits.reduce((s, r) => s + Number(r.games), 0), nhlReg?.gamesPlayed);
    }
    if (diffs.length) {
      bad.push(`${p.full_name} (${p.id}${p.pre2007 ? ", pre-2007 career" : ""}): ${diffs.join("; ")}`);
      if (p.pre2007) pre.bad++;
    }
  }
  console.log(`Checked ${checked} players with pages (${pre.n} with pre-2007 careers); ${notInNhl} not in the NHL's totals (no NHL games yet).`);
  console.log(`Match: ${checked - bad.length} of ${checked}. Pre-2007 careers: ${pre.n - pre.bad} of ${pre.n}.`);
  for (const b of bad) console.log(`  DIFF ${b}`);
  await pool.end();
  process.exit(bad.length ? 1 : 0);
})();
