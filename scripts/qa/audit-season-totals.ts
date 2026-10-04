// Every player's season totals, league-wide and every season, against the
// NHL's own (stats API, one call per season and game type): skater GP,
// goals and assists; goalie GP and W-L-OTL-T. Covers players without a
// page too, since Ask reads them all. check-player-careers.ts checks the
// pages; this finds which season, and from there which game, is off.
//
// Daily in .github/workflows/refresh-data.yml (fails the run on any new
// difference). Run when no games are in progress.
//
// Usage: npx tsx --env-file=.env.local scripts/qa/audit-season-totals.ts [--from 20052006]

import { pool } from "../../lib/db";
import { gamesInProgress } from "./games-in-progress";

/* eslint-disable @typescript-eslint/no-explicit-any -- the NHL feed is untyped JSON */
async function nhl(kind: "skater" | "goalie", season: string, gameTypeId: 2 | 3): Promise<any[]> {
  const exp = encodeURIComponent(`seasonId=${season} and gameTypeId=${gameTypeId}`);
  const url = `https://api.nhle.com/stats/rest/en/${kind}/summary?isAggregate=false&isGame=false&start=0&limit=-1&cayenneExp=${exp}`;
  for (let i = 0; i < 8; i++) {
    const res = await fetch(url).catch(() => null);
    if (res?.ok) return (await res.json()).data;
    await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
  }
  throw new Error(`NHL stats API failed: ${url}`);
}

// Differences where the NHL disagrees with itself, each looked into
// (2026-10-03), keyed "season gameType playerId". Anything else fails.
const KNOWN: Record<string, string> = {
  // His game log is empty and his box rows don't match his official GP, so
  // they're left unmarked (scripts/stats/load-nhl-appearances.ts).
  "19731974 regular 8452477": "Rick Wilson: NHL game log empty",
  "19741975 playoff 8452477": "Rick Wilson: NHL game log empty",
  "19751976 regular 8452477": "Rick Wilson: NHL game log empty",
  "19751976 playoff 8452477": "Rick Wilson: NHL game log empty",
  // The NHL's totals count one more game than its own game log lists.
  "19271928 regular 8448197": "Joe Primeau: NHL total 2 GP, its game log 1",
  "19601961 playoff 8447591": "Chico Maki: NHL total 1 GP, its game log none",
};

const OURS_SKATERS = `
  select g.season, s.player_id, count(*)::int gp, sum(s.goals)::int g, sum(s.assists)::int a
  from nhl_skater_games s join nhl_stat_games g on g.id = s.game_id
  where s.played and g.season = $1 and g.season < '20072008' and g.game_type = $2 group by 1, 2
  union all
  select g.season_id, s.player_id, count(*)::int, sum(s.goals)::int, sum(s.assists)::int
  from skater_game_stats s join games g on g.id = s.game_id
  where g.season_id = $1 and g.season_id >= '20072008' and g.game_type = $2 group by 1, 2`;
const OURS_GOALIES = `
  select x.player_id, count(*)::int gp, count(*) filter (where decision = 'W')::int w, count(*) filter (where decision = 'L')::int l,
         count(*) filter (where decision = 'OTL')::int otl, count(*) filter (where decision = 'T')::int t
  from nhl_goalie_games x join nhl_stat_games g on g.id = x.game_id
  where g.season = $1 and g.season < '20072008' and g.game_type = $2 group by 1
  union all
  select x.player_id, count(*)::int, count(*) filter (where decision = 'W')::int, count(*) filter (where decision = 'L')::int,
         count(*) filter (where decision = 'OTL')::int, 0
  from goalie_game_stats x join games g on g.id = x.game_id
  where g.season_id = $1 and g.season_id >= '20072008' and g.game_type = $2 group by 1`;

(async () => {
  const fromArg = process.argv.indexOf("--from");
  const from = fromArg >= 0 ? process.argv[fromArg + 1] : "19171918";
  const { rows: seasons } = await pool.query(
    `select distinct season from nhl_games where season >= $1 union select distinct season_id from games where season_id >= $1 order by 1`,
    [from],
  );
  // A game under way (or just ended, not yet official) makes this season's
  // totals differ for no real reason: check every other season and say so.
  const busy = await gamesInProgress();
  if (busy.length) {
    const current = seasons.at(-1)?.season;
    seasons.splice(seasons.length - 1, 1);
    console.log(`Skipping ${current}: games in progress (${busy.join(", ")}); every other season checked.`);
  }
  const diffs: string[] = [];
  const known: string[] = [];
  for (const { season } of seasons) {
    for (const [gt, gtId] of [["regular", 2], ["playoff", 3]] as const) {
      // One NHL call at a time: the stats API drops some under load.
      const nSk = await nhl("skater", season, gtId);
      const nGk = await nhl("goalie", season, gtId);
      const [oSk, oGk] = await Promise.all([pool.query(OURS_SKATERS, [season, gt]), pool.query(OURS_GOALIES, [season, gt])]);
      const sum = (rows: any[], keys: Record<string, string>) => {
        const m = new Map<number, Record<string, number>>();
        for (const r of rows) {
          const o = m.get(Number(r.playerId)) ?? Object.fromEntries(Object.keys(keys).map((k) => [k, 0]));
          for (const [k, f] of Object.entries(keys)) o[k] += Number(r[f] ?? 0);
          m.set(Number(r.playerId), o);
        }
        return m;
      };
      const theirsSk = sum(nSk, { gp: "gamesPlayed", g: "goals", a: "assists" });
      const theirsGk = sum(nGk, { gp: "gamesPlayed", w: "wins", l: "losses", otl: "otLosses", t: "ties" });
      const name = new Map([...nSk, ...nGk].map((r) => [Number(r.playerId), r.skaterFullName ?? r.goalieFullName]));
      const compare = (kind: string, ours: Map<number, any>, theirs: Map<number, Record<string, number>>, keys: string[]) => {
        for (const id of new Set([...ours.keys(), ...theirs.keys()])) {
          const o = ours.get(id), t = theirs.get(id);
          const bad = keys.filter((k) => Number(o?.[k] ?? 0) !== Number(t?.[k] ?? 0));
          if (bad.length && KNOWN[`${season} ${gt} ${id}`]) known.push(`${season} ${gt} ${id}: ${KNOWN[`${season} ${gt} ${id}`]}`);
          else if (bad.length) diffs.push(`${season} ${gt} ${kind} ${id} ${name.get(id) ?? "?"}: ${bad.map((k) => `${k} ${o?.[k] ?? 0} vs NHL ${t?.[k] ?? 0}`).join(", ")}`);
        }
      };
      compare("skater", new Map(oSk.rows.map((r) => [Number(r.player_id), r])), theirsSk, ["gp", "g", "a"]);
      compare("goalie", new Map(oGk.rows.map((r) => [Number(r.player_id), r])), theirsGk, ["gp", "w", "l", "otl", "t"]);
    }
    process.stderr.write(`${season} `);
  }
  console.log(`\n${diffs.length} player-seasons differ (${known.length} known NHL inconsistencies, listed below).`);
  for (const d of diffs) console.log(`  DIFF ${d}`);
  for (const k of known) console.log(`  known ${k}`);
  await pool.end();
  process.exit(diffs.length ? 1 : 0);
})();
