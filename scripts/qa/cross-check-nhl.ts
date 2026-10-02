// Cross-checks the site's own database against the NHL API, an independent
// source (docs/verification.md, layer 6). Every comparison is exact; any
// difference is printed with both values.
//   1. current standings, all 32 teams
//   2. last season's Bruins player totals (skaters and goalies)
//   3. 40 random box scores since 2007-08: score and every player's G/A/SOG
//   4. regular-season career totals for 25 random players whose whole
//      career is in our data (debut 2007-08 or later)
//   5. every Bruins result last season (score and OT/SO)
//
// Usage: npx tsx --env-file=.env.local scripts/qa/cross-check-nhl.ts [--seed N]

import { Client } from "pg";

const API = "https://api-web.nhle.com/v1";
const seedArg = process.argv.indexOf("--seed");
let seed = seedArg >= 0 ? Number(process.argv[seedArg + 1]) : Date.now() % 100000;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

/* eslint-disable @typescript-eslint/no-explicit-any -- the NHL feed is untyped JSON */
async function get(url: string): Promise<any> {
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, { headers: { "User-Agent": "causeway-qa/1.0" } });
    if (res.ok) return res.json();
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw new Error(`failed: ${url}`);
}

let checks = 0;
const problems: string[] = [];
function same(what: string, ours: unknown, theirs: unknown) {
  checks++;
  if (String(ours) !== String(theirs)) problems.push(`${what}: ours ${ours}, NHL ${theirs}`);
}

async function main() {
  console.log(`seed ${seed}`);
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  // 1. Standings
  const nhlStandings = (await get(`${API}/standings/now`)).standings as any[];
  const { rows: ours } = await db.query(
    `with latest as (select max(season_id) as s from standings_snapshots)
     select distinct on (t.abbrev) t.abbrev, s.games_played, s.wins, s.losses, s.ot_losses, s.points
     from standings_snapshots s join teams t on t.id = s.team_id join latest l on l.s = s.season_id
     order by t.abbrev, s.snapshot_date desc`,
  );
  const byAbbrev = new Map(ours.map((r) => [r.abbrev, r]));
  for (const t of nhlStandings) {
    const a = t.teamAbbrev.default;
    const o = byAbbrev.get(a);
    if (!o) {
      problems.push(`standings: ${a} missing from ours`);
      continue;
    }
    same(`standings ${a} GP`, o.games_played, t.gamesPlayed);
    same(`standings ${a} W-L-OTL`, `${o.wins}-${o.losses}-${o.ot_losses}`, `${t.wins}-${t.losses}-${t.otLosses}`);
    same(`standings ${a} PTS`, o.points, t.points);
  }
  console.log(`1. standings: ${nhlStandings.length} teams compared`);

  // 2. Last season's Bruins player totals
  const stats = await get(`${API}/club-stats/BOS/20252026/2`);
  const { rows: sk } = await db.query(
    `select s.player_id, count(*)::int gp, sum(s.goals)::int g, sum(s.assists)::int a, sum(s.points)::int p, sum(s.shots)::int sog
     from skater_game_stats s join games g on g.id = s.game_id join teams t on t.id = s.team_id
     where t.abbrev = 'BOS' and g.season_id = '20252026' and g.game_type = 'regular' group by s.player_id`,
  );
  const skBy = new Map(sk.map((r) => [Number(r.player_id), r]));
  for (const p of stats.skaters) {
    const o = skBy.get(p.playerId);
    const who = `${p.firstName.default} ${p.lastName.default}`;
    if (!o) {
      problems.push(`2025-26 BOS skater ${who} missing from ours`);
      continue;
    }
    same(`2025-26 BOS ${who} GP`, o.gp, p.gamesPlayed);
    same(`2025-26 BOS ${who} G-A-P`, `${o.g}-${o.a}-${o.p}`, `${p.goals}-${p.assists}-${p.points}`);
    same(`2025-26 BOS ${who} SOG`, o.sog, p.shots);
  }
  const { rows: gk } = await db.query(
    `select s.player_id, count(*)::int gp, count(*) filter (where decision='W')::int w, count(*) filter (where decision='L')::int l,
            count(*) filter (where decision='OTL')::int otl, sum(saves)::int sv, sum(shots_against)::int sa
     from goalie_game_stats s join games g on g.id = s.game_id join teams t on t.id = s.team_id
     where t.abbrev = 'BOS' and g.season_id = '20252026' and g.game_type = 'regular' and coalesce(s.toi_seconds,0) > 0 group by s.player_id`,
  );
  const gkBy = new Map(gk.map((r) => [Number(r.player_id), r]));
  for (const p of stats.goalies) {
    const o = gkBy.get(p.playerId);
    const who = `${p.firstName.default} ${p.lastName.default}`;
    if (!o) {
      problems.push(`2025-26 BOS goalie ${who} missing from ours`);
      continue;
    }
    same(`2025-26 BOS ${who} GP`, o.gp, p.gamesPlayed);
    same(`2025-26 BOS ${who} W-L-OTL`, `${o.w}-${o.l}-${o.otl}`, `${p.wins}-${p.losses}-${p.overtimeLosses}`);
    same(`2025-26 BOS ${who} saves/shots`, `${o.sv}/${o.sa}`, `${p.saves}/${p.shotsAgainst}`);
  }
  console.log(`2. 2025-26 Bruins: ${stats.skaters.length} skaters, ${stats.goalies.length} goalies compared`);

  // 3. Random box scores
  const { rows: allGames } = await db.query(`select id from games where game_type in ('regular','playoff') order by id`);
  const sample = Array.from({ length: 40 }, () => allGames[Math.floor(rand() * allGames.length)].id);
  for (const id of sample) {
    const box = await get(`${API}/gamecenter/${id}/boxscore`);
    const { rows: [g] } = await db.query(`select home_score, away_score from games where id = $1`, [id]);
    same(`game ${id} score`, `${g.away_score}-${g.home_score}`, `${box.awayTeam.score}-${box.homeTeam.score}`);
    const { rows: ps } = await db.query(`select player_id, goals, assists, shots from skater_game_stats where game_id = $1`, [id]);
    const pBy = new Map(ps.map((r) => [Number(r.player_id), r]));
    for (const side of ["homeTeam", "awayTeam"]) {
      const sks = [...(box.playerByGameStats?.[side]?.forwards ?? []), ...(box.playerByGameStats?.[side]?.defense ?? [])];
      for (const p of sks) {
        const o = pBy.get(p.playerId);
        if (!o) {
          if ((p.toi ?? "00:00") !== "00:00") problems.push(`game ${id}: ${p.name.default} missing from ours`);
          continue;
        }
        same(`game ${id} ${p.name.default} G/A/SOG`, `${o.goals}/${o.assists}/${o.shots}`, `${p.goals}/${p.assists}/${p.sog}`);
      }
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log(`3. box scores: ${sample.length} random games compared`);

  // 4. Career totals, players whose whole career is in our data
  const { rows: debuts } = await db.query(
    `select s.player_id, min(g.season_id) as first from skater_game_stats s join games g on g.id = s.game_id
     group by s.player_id having min(g.season_id) >= '20082009' and count(*) > 100`,
  );
  const picks = Array.from({ length: 25 }, () => Number(debuts[Math.floor(rand() * debuts.length)].player_id));
  for (const pid of picks) {
    const land = await get(`${API}/player/${pid}/landing`);
    const nhl = land.careerTotals?.regularSeason;
    if (!nhl) continue;
    const { rows: [o] } = await db.query(
      `select count(*)::int gp, sum(goals)::int g, sum(assists)::int a from skater_game_stats s join games g on g.id = s.game_id
       where s.player_id = $1 and g.game_type = 'regular'`,
      [pid],
    );
    const who = `${land.firstName.default} ${land.lastName.default}`;
    same(`career ${who} GP`, o.gp, nhl.gamesPlayed);
    same(`career ${who} G-A`, `${o.g}-${o.a}`, `${nhl.goals}-${nhl.assists}`);
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log(`4. career totals: ${picks.length} players compared`);

  // 5. Every Bruins result last season
  const sched = await get(`${API}/club-schedule-season/BOS/20252026`);
  const played = sched.games.filter((g: any) => (g.gameType === 2 || g.gameType === 3) && (g.gameState === "OFF" || g.gameState === "FINAL"));
  for (const g of played) {
    const { rows: [o] } = await db.query(`select home_score, away_score, game_end_type from games where id = $1`, [g.id]);
    if (!o) {
      problems.push(`2025-26 BOS game ${g.id} missing from ours`);
      continue;
    }
    same(`2025-26 BOS game ${g.id} score`, `${o.away_score}-${o.home_score}`, `${g.awayTeam.score}-${g.homeTeam.score}`);
    const end = g.gameOutcome?.lastPeriodType === "OT" ? "overtime" : g.gameOutcome?.lastPeriodType === "SO" ? "shootout" : "regulation";
    same(`2025-26 BOS game ${g.id} ending`, o.game_end_type, end);
  }
  console.log(`5. 2025-26 Bruins results: ${played.length} games compared`);

  await db.end();
  console.log(`\n${checks} values compared, ${problems.length} differences.`);
  for (const p of problems.slice(0, 60)) console.log(`  DIFF ${p}`);
  process.exit(problems.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
