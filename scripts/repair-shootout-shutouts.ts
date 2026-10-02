// One-time repair (2026-10-02): a 0-0 game lost in a shootout is a
// shutout for a goalie who played it alone (the NHL credits it), but the
// loader excluded shootout losses (fixed in scripts/backfill-season.ts).
// Sets shutout on those rows. Dry run by default; --apply to write.
//
// Usage: npx tsx --env-file=.env.local scripts/repair-shootout-shutouts.ts [--apply]

import { Client } from "pg";

const FIND = `
  select s.game_id, s.player_id
  from goalie_game_stats s join games g on g.id = s.game_id
  where g.game_end_type = 'shootout' and not s.shutout and coalesce(s.toi_seconds, 0) > 0
    and (case when s.team_id = g.home_team_id then g.home_score else g.away_score end) = 0
    and (case when s.team_id = g.home_team_id then g.away_score else g.home_score end) = 1
    and (select count(*) from goalie_game_stats o where o.game_id = s.game_id and o.team_id = s.team_id and coalesce(o.toi_seconds, 0) > 0) = 1`;

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const { rows } = await c.query(FIND);
  console.log(`${rows.length} goalie games: 0-0 through overtime, lost in the shootout, played alone, not marked a shutout.`);
  if (process.argv.includes("--apply")) {
    await c.query("begin");
    const r = await c.query(`update goalie_game_stats s set shutout = true, updated_at = now() from (${FIND}) f where s.game_id = f.game_id and s.player_id = f.player_id`);
    if (r.rowCount !== rows.length) {
      await c.query("rollback");
      throw new Error(`Expected ${rows.length} rows, updated ${r.rowCount}; rolled back.`);
    }
    await c.query("commit");
    console.log(`Updated ${r.rowCount}.`);
  }
  await c.end();
})();
