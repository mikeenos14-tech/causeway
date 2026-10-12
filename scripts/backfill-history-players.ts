// Gives every player whose career is only in the history tables (before
// 2007-08) a page: a players row with his bio from the NHL (name,
// position, shoots/catches, birth date and country, height, weight) and
// his photo in player_headshots. 5,253 players on 2026-10-11, Ray Bourque
// among them. Players the NHL has no bio for still get a row from the
// history tables (name and position), so they still get a page.
//
// Idempotent: only players without a players row are fetched.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/backfill-history-players.ts --dry-run 5
//   npx tsx --env-file=.env.local scripts/backfill-history-players.ts

import { Client } from "pg";

/* eslint-disable @typescript-eslint/no-explicit-any -- the NHL feed is untyped JSON */
// Every player's bio in two calls (the NHL's stats service, all seasons,
// regular season and playoffs), not one call per player: the per-player
// endpoint is rate-limited to about one player every 2.7 s (4 hours).
// Height comes in inches and weight in pounds there.
async function bios(): Promise<Map<number, any>> {
  const out = new Map<number, any>();
  for (const kind of ["skater", "goalie"]) {
    for (const gt of [2, 3]) {
      const exp = encodeURIComponent(`gameTypeId=${gt} and seasonId>=19171918 and seasonId<=20262027`);
      for (let i = 0; i < 6; i++) {
        const res = await fetch(`https://api.nhle.com/stats/rest/en/${kind}/bios?isAggregate=true&isGame=false&limit=-1&start=0&cayenneExp=${exp}`).catch(() => null);
        if (res?.ok) {
          for (const r of (await res.json()).data) if (!out.has(Number(r.playerId))) out.set(Number(r.playerId), r);
          break;
        }
        if (i === 5) throw new Error(`NHL bios (${kind}, ${gt}) unavailable`);
        await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
      }
    }
  }
  return out;
}

const photo = (id: number) => `https://assets.nhle.com/mugs/nhl/latest/${id}.png`;
// Only a real photo: players without one are redirected to a generic
// silhouette, and initials read better than that.
const hasPhoto = async (id: number) => (await fetch(photo(id), { method: "HEAD", redirect: "manual" }).catch(() => null))?.status === 200;

(async () => {
  const dry = process.argv.indexOf("--dry-run");
  const limit = dry >= 0 ? Number(process.argv[dry + 1] ?? 5) : Infinity;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const { rows } = await db.query(
    `with apps as (
       select s.player_id, g.season, g.game_date, s.team_id from nhl_skater_games s join nhl_games g on g.id = s.game_id where s.played
       union all
       select x.player_id, g.season, g.game_date, x.team_id from nhl_goalie_games x join nhl_stat_games g on g.id = x.game_id
       where coalesce(x.toi_sec, 1) > 0 or x.decision is not null),
     last as (select distinct on (player_id) player_id, season, team_id from apps order by player_id, game_date desc)
     select n.id, n.full_name, n.position, l.season, t.tri_code
     from nhl_players n join last l on l.player_id = n.id join nhl_teams t on t.id = l.team_id
     where not exists (select 1 from players p where p.id = n.id)
     order by n.id`,
  );
  console.log(`${rows.length} players with a history career and no page.`);
  const bio = await bios();
  console.log(`${bio.size} NHL bios fetched.`);
  const todo = rows.slice(0, limit);
  let noBio = 0, photos = 0;
  for (let i = 0; i < todo.length; i += 8) {
    const batch = todo.slice(i, i + 8);
    const withPhoto = await Promise.all(batch.map((r) => hasPhoto(Number(r.id))));
    for (let j = 0; j < batch.length; j++) {
      const r = batch[j], b = bio.get(Number(r.id));
      if (!b) noBio++;
      const name = b ? (b.skaterFullName ?? b.goalieFullName) : r.full_name;
      const pos = b?.positionCode && ["C", "L", "R", "D", "G"].includes(b.positionCode) ? b.positionCode : r.position;
      const row = [
        Number(r.id), name, pos, b?.shootsCatches ?? null, b?.birthDate ?? null, b?.birthCountryCode ?? null,
        b?.height ? Math.round(b.height * 2.54) : null, b?.weight ? Math.round(b.weight * 0.45359237) : null,
      ];
      if (dry >= 0) {
        console.log(JSON.stringify(row), withPhoto[j] ? "photo" : "no photo");
        continue;
      }
      await db.query(
        `insert into players (id, full_name, position, shoots_catches, birth_date, birth_country, height_cm, weight_kg)
         values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do nothing`,
        row,
      );
      if (withPhoto[j]) {
        photos++;
        await db.query(
          `insert into player_headshots (player_id, url, team_abbrev, season_id, synced_at) values ($1, $2, $3, $4, now()) on conflict (player_id) do nothing`,
          [Number(r.id), photo(Number(r.id)), r.tri_code, r.season],
        );
      }
    }
    if ((i / 8) % 50 === 0) console.log(`  ${Math.min(i + 8, todo.length)}/${todo.length}`);
  }
  console.log(`${dry >= 0 ? "Dry run: " : ""}${todo.length} players${dry >= 0 ? " checked" : " given pages"}; ${photos} photos; ${noBio} without an NHL bio (history name and position used).`);
  await db.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
