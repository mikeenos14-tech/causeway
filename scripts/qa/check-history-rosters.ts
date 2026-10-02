// Season totals built from our pre-2007 box scores (nhl_skater_games, what
// the Roster page's season picker shows) against the NHL's official season
// totals (stats API skater summary), for every player in a spread of
// seasons. GP, G, A, PIM always; +/- and shots where the era tracked them.
//
// Usage: npx tsx --env-file=.env.local scripts/qa/check-history-rosters.ts [season ...]

import { pool } from "../../lib/db";

const DEFAULT = ["19251926", "19371938", "19501951", "19591960", "19661967", "19701971", "19801981", "19871988", "19951996", "20022003", "20052006"];
const seasons = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;

/* eslint-disable @typescript-eslint/no-explicit-any -- the NHL feed is untyped JSON */
async function nhlSeason(season: string): Promise<any[]> {
  const out: any[] = [];
  const sort = encodeURIComponent(JSON.stringify([{ property: "playerId", direction: "ASC" }]));
  for (let start = 0; ; start += 100) {
    let r: any = null;
    for (let i = 0; i < 5 && !r; i++) {
      const res = await fetch(`https://api.nhle.com/stats/rest/en/skater/summary?isAggregate=false&isGame=false&start=${start}&limit=100&sort=${sort}&cayenneExp=${encodeURIComponent(`seasonId=${season} and gameTypeId=2`)}`);
      if (res.ok) r = await res.json();
      else await new Promise((x) => setTimeout(x, 2000 * (i + 1)));
    }
    if (!r) throw new Error(`NHL stats unavailable for ${season}`);
    out.push(...r.data);
    if (r.data.length < 100) break;
  }
  return out;
}

(async () => {
  let compared = 0, diffs = 0;
  for (const season of seasons) {
    const api = await nhlSeason(season);
    const { rows } = await pool.query(
      `select s.player_id, count(*)::int gp, sum(s.goals)::int g, sum(s.assists)::int a, sum(s.pim)::int pim, sum(s.plus_minus)::int pm, sum(s.sog)::int sog,
              bool_and(s.plus_minus is not null) pm_tracked, bool_and(s.sog is not null) sog_tracked
       from nhl_skater_games s join nhl_games g on g.id = s.game_id
       where g.season = $1 and g.game_type = 'regular' group by s.player_id`,
      [season],
    );
    const ours = new Map(rows.map((r) => [Number(r.player_id), r]));
    let sDiffs = 0;
    const examples: string[] = [];
    const seen = new Set<number>();
    for (const p of api) {
      if (p.positionCode === "G") continue; // goalies aren't in the skater box
      seen.add(p.playerId);
      const o = ours.get(p.playerId);
      compared++;
      const fields: [string, unknown, unknown][] = [
        ["GP", o?.gp ?? 0, p.gamesPlayed],
        ["G", o?.g ?? 0, p.goals],
        ["A", o?.a ?? 0, p.assists],
        ["PIM", o?.pim ?? 0, p.penaltyMinutes],
      ];
      if (o?.pm_tracked) fields.push(["+/-", o.pm, p.plusMinus]);
      if (o?.sog_tracked && p.shots != null) fields.push(["SOG", o.sog, p.shots]);
      const bad = fields.filter(([, a, b]) => Number(a) !== Number(b));
      if (bad.length) {
        sDiffs++;
        if (examples.length < 4) examples.push(`${p.skaterFullName}: ${bad.map(([k, a, b]) => `${k} ours ${a} NHL ${b}`).join(", ")}`);
      }
    }
    const extra = [...ours.keys()].filter((id) => !seen.has(id)).length;
    diffs += sDiffs;
    console.log(`${season}: ${api.filter((p) => p.positionCode !== "G").length} skaters, ${sDiffs} differ${extra ? `, ${extra} in ours but not the NHL's list` : ""}`);
    for (const e of examples) console.log(`    ${e}`);
  }
  console.log(`\n${compared} player-seasons compared, ${diffs} differ.`);
  await pool.end();
  process.exit(diffs ? 1 : 0);
})();
