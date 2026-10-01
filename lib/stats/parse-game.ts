// One game's raw NHL feed (play-by-play + landing summary, as cached by
// scripts/stats/fetch-nhl-history.ts) -> the rows of the stats data layer.
// A pure function with no database or network, so it's tested directly on
// famous games (scripts/stats/test-parse-game.ts).
//
// Sources, by what each is best at:
//   play-by-play  event ids, goal and penalty times, scorers, assists,
//                 on-ice counts (situationCode, 2009-10 on), shot events
//   landing       strength flags (PP/SH) reaching back decades before
//                 situation codes, and an empty-net modifier
//   game list     the official final score (shootout winner included)

/* eslint-disable @typescript-eslint/no-explicit-any -- the NHL feed is untyped JSON */

export type ListRow = { id: number; season: number; gameType: number; gameDate: string; homeTeamId: number; visitingTeamId: number; homeScore: number; visitingScore: number };

export type GoalRow = {
  event_id: number;
  period: number;
  period_type: "REG" | "OT";
  time_in_period_sec: number;
  time_elapsed_sec: number;
  team_id: number;
  scorer_id: number | null;
  assist1_id: number | null;
  assist2_id: number | null;
  strength: "EV" | "PP" | "SH" | "PS" | null;
  empty_net: boolean | null;
  situation_code: string | null;
  score_before_home: number;
  score_before_away: number;
};

export type PenaltyRow = {
  event_id: number;
  period: number;
  period_type: string;
  time_in_period_sec: number;
  time_elapsed_sec: number;
  team_id: number | null;
  player_id: number | null;
  drawn_by_id: number | null;
  served_by_id: number | null;
  minutes: number | null;
  type_code: string | null;
  infraction: string | null;
  situation_code: string | null;
};

export type PeriodRow = { period: number; period_type: string; home_goals: number; away_goals: number; home_shots: number | null; away_shots: number | null };

export type ParsedGame = {
  game: {
    id: number;
    season: string;
    game_type: "regular" | "playoff";
    game_date: string;
    start_time_utc: string | null;
    home_team_id: number;
    away_team_id: number;
    home_score: number;
    away_score: number;
    final_state: "REG" | "OT" | "SO" | "TIE";
    ot_periods: number;
    home_sog: number | null;
    away_sog: number | null;
    venue_name: string | null;
    venue_city: string | null;
    goals_with_time: number;
    goals_match_final: boolean;
    has_situation_codes: boolean;
    has_shot_events: boolean;
  };
  goals: GoalRow[];
  penalties: PenaltyRow[];
  periods: PeriodRow[];
  players: { id: number; full_name: string; position: string | null }[];
  warnings: string[];
};

export function clockToSec(t: string | undefined | null): number | null {
  const m = /^(\d+):(\d{2})$/.exec(t ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const name = (n: any) => n?.default ?? "";

// situationCode digits: away goalie, away skaters, home skaters, home goalie.
export function strengthFromSituation(code: string, scorerIsHome: boolean): { strength: "EV" | "PP" | "SH" | "PS"; emptyNet: boolean } | null {
  if (!/^\d{4}$/.test(code)) return null;
  const [awayG, awayS, homeS, homeG] = code.split("").map(Number);
  // Penalty shot: one skater against one goalie.
  if ((code === "0101" || code === "1010")) return { strength: "PS", emptyNet: false };
  const own = scorerIsHome ? { g: homeG, s: homeS } : { g: awayG, s: awayS };
  const opp = scorerIsHome ? { g: awayG, s: awayS } : { g: homeG, s: homeS };
  // An extra attacker (own goalie pulled) isn't a power play: compare the
  // skaters each side would have with its goalie in.
  const ownBase = own.s - (own.g === 0 ? 1 : 0);
  const oppBase = opp.s - (opp.g === 0 ? 1 : 0);
  return { strength: ownBase > oppBase ? "PP" : ownBase < oppBase ? "SH" : "EV", emptyNet: opp.g === 0 };
}

export function parseGame(list: ListRow, pbp: any, landing: any): ParsedGame {
  const warnings: string[] = [];
  const homeId = list.homeTeamId;
  const awayId = list.visitingTeamId;
  const plays: any[] = pbp?.plays ?? [];
  const isSO = (p: any) => p.periodDescriptor?.periodType === "SO";
  const elapsed = (period: number, sec: number) => (period - 1) * 1200 + sec;

  // Landing goals, indexed for strength/empty-net lookups by period + time + scorer.
  const landingGoals = (landing?.summary?.scoring ?? []).flatMap((p: any) =>
    p.periodDescriptor?.periodType === "SO" ? [] : (p.goals ?? []).map((g: any) => ({ ...g, _period: p.periodDescriptor?.number })),
  );
  const landingKey = (period: number, time: string | undefined, scorer: number | null) => `${period}|${time}|${scorer ?? ""}`;
  const landingByKey = new Map(landingGoals.map((g: any) => [landingKey(g._period, g.timeInPeriod, g.playerId), g]));
  const landingStrength = (g: any): GoalRow["strength"] => {
    const s = String(g?.strength ?? "").toLowerCase();
    return s === "pp" ? "PP" : s === "sh" ? "SH" : s === "ev" ? "EV" : s === "ps" ? "PS" : null;
  };

  const pbpGoals = plays.filter((p) => p.typeDescKey === "goal" && !isSO(p));
  let goalSource: { period: number; periodType: string; time: string; teamId: number; scorer: number | null; a1: number | null; a2: number | null; eventId: number; situation: string | null; landing: any }[];
  if (pbpGoals.length > 0) {
    goalSource = pbpGoals.map((p) => ({
      period: p.periodDescriptor.number,
      periodType: p.periodDescriptor.periodType,
      time: p.timeInPeriod,
      teamId: p.details?.eventOwnerTeamId,
      scorer: p.details?.scoringPlayerId ?? null,
      a1: p.details?.assist1PlayerId ?? null,
      a2: p.details?.assist2PlayerId ?? null,
      eventId: p.eventId,
      situation: p.situationCode ?? null,
      landing: landingByKey.get(landingKey(p.periodDescriptor.number, p.timeInPeriod, p.details?.scoringPlayerId ?? null)),
    }));
  } else {
    // No play-by-play goals: fall back to the landing summary (synthetic ids).
    const abbrevToId = new Map<string, number>([
      [name(pbp?.homeTeam?.abbrev) || pbp?.homeTeam?.abbrev, homeId],
      [name(pbp?.awayTeam?.abbrev) || pbp?.awayTeam?.abbrev, awayId],
    ]);
    goalSource = landingGoals.map((g: any, i: number) => ({
      period: g._period,
      periodType: g._period > (pbp?.regPeriods ?? 3) ? "OT" : "REG",
      time: g.timeInPeriod,
      teamId: abbrevToId.get(name(g.teamAbbrev)) ?? (g.isHome ? homeId : awayId),
      scorer: g.playerId ?? null,
      a1: g.assists?.[0]?.playerId ?? null,
      a2: g.assists?.[1]?.playerId ?? null,
      eventId: -(i + 1),
      situation: g.situationCode ?? null,
      landing: g,
    }));
    if (landingGoals.length) warnings.push("goals from landing summary (no play-by-play goals)");
  }

  goalSource.sort((a, b) => a.period - b.period || (clockToSec(a.time) ?? 0) - (clockToSec(b.time) ?? 0) || a.eventId - b.eventId);

  let home = 0;
  let away = 0;
  const goals: GoalRow[] = [];
  let goalsWithTime = 0;
  for (const g of goalSource) {
    const sec = clockToSec(g.time);
    if (sec != null) goalsWithTime++;
    const isHome = g.teamId === homeId;
    if (!isHome && g.teamId !== awayId) warnings.push(`goal ${g.eventId} credited to team ${g.teamId}, not in this game`);
    const fromSituation = g.situation ? strengthFromSituation(g.situation, isHome) : null;
    const modifier = String(g.landing?.goalModifier ?? "");
    goals.push({
      event_id: g.eventId,
      period: g.period,
      period_type: g.periodType === "OT" ? "OT" : "REG",
      time_in_period_sec: sec ?? 0,
      time_elapsed_sec: elapsed(g.period, sec ?? 0),
      team_id: g.teamId,
      scorer_id: g.scorer,
      assist1_id: g.a1,
      assist2_id: g.a2,
      strength: fromSituation?.strength ?? landingStrength(g.landing),
      empty_net: fromSituation ? fromSituation.emptyNet : modifier === "empty-net" ? true : null,
      situation_code: g.situation,
      score_before_home: home,
      score_before_away: away,
    });
    if (isHome) home++;
    else away++;
  }

  const penalties: PenaltyRow[] = plays
    .filter((p) => p.typeDescKey === "penalty")
    .map((p) => {
      const sec = clockToSec(p.timeInPeriod) ?? 0;
      return {
        event_id: p.eventId,
        period: p.periodDescriptor?.number ?? 0,
        period_type: p.periodDescriptor?.periodType ?? "REG",
        time_in_period_sec: sec,
        time_elapsed_sec: elapsed(p.periodDescriptor?.number ?? 1, sec),
        team_id: p.details?.eventOwnerTeamId ?? null,
        player_id: p.details?.committedByPlayerId ?? null,
        drawn_by_id: p.details?.drawnByPlayerId ?? null,
        served_by_id: p.details?.servedByPlayerId ?? null,
        minutes: p.details?.duration ?? null,
        type_code: p.details?.typeCode ?? null,
        infraction: p.details?.descKey ?? null,
        situation_code: p.situationCode ?? null,
      };
    });

  // Final state. The game list's score includes the shootout winner's +1.
  const outcome = pbp?.gameOutcome ?? {};
  const lastType: string = outcome.lastPeriodType ?? (plays.some(isSO) ? "SO" : goals.some((g) => g.period_type === "OT") ? "OT" : "REG");
  const tie = list.homeScore === list.visitingScore;
  const final_state = tie ? "TIE" : lastType === "SO" ? "SO" : lastType === "OT" ? "OT" : "REG";
  const expectedGoals = list.homeScore + list.visitingScore - (final_state === "SO" ? 1 : 0);

  // Period scores, with shots only where shot events exist.
  const shotEvents = plays.filter((p) => p.typeDescKey === "shot-on-goal" || (p.typeDescKey === "goal" && !isSO(p)));
  const hasShotEvents = plays.some((p) => p.typeDescKey === "shot-on-goal");
  const periodNums = new Set<number>([...goals.map((g) => g.period), ...plays.filter((p) => !isSO(p)).map((p) => p.periodDescriptor?.number).filter(Boolean)]);
  const regPeriods = pbp?.regPeriods ?? 3;
  for (let p = 1; p <= regPeriods; p++) periodNums.add(p);
  const periods: PeriodRow[] = [...periodNums]
    .sort((a, b) => a - b)
    .map((p) => {
      const inP = (team: number) => shotEvents.filter((e) => e.periodDescriptor?.number === p && e.details?.eventOwnerTeamId === team).length;
      return {
        period: p,
        period_type: p > regPeriods ? "OT" : "REG",
        home_goals: goals.filter((g) => g.period === p && g.team_id === homeId).length,
        away_goals: goals.filter((g) => g.period === p && g.team_id === awayId).length,
        home_shots: hasShotEvents ? inP(homeId) : null,
        away_shots: hasShotEvents ? inP(awayId) : null,
      };
    });

  const players = new Map<number, { id: number; full_name: string; position: string | null }>();
  for (const r of pbp?.rosterSpots ?? []) {
    if (r.playerId) players.set(r.playerId, { id: r.playerId, full_name: `${name(r.firstName)} ${name(r.lastName)}`.trim(), position: r.positionCode ?? null });
  }

  const sog = (t: any) => (typeof t?.sog === "number" ? t.sog : null);
  return {
    game: {
      id: list.id,
      season: String(list.season),
      game_type: list.gameType === 3 ? "playoff" : "regular",
      game_date: list.gameDate,
      start_time_utc: pbp?.startTimeUTC ?? null,
      home_team_id: homeId,
      away_team_id: awayId,
      home_score: list.homeScore,
      away_score: list.visitingScore,
      final_state,
      ot_periods: outcome.otPeriods ?? (final_state === "OT" || final_state === "SO" ? 1 : 0),
      home_sog: sog(pbp?.homeTeam),
      away_sog: sog(pbp?.awayTeam),
      venue_name: name(pbp?.venue) || null,
      venue_city: name(pbp?.venueLocation) || null,
      goals_with_time: goalsWithTime,
      goals_match_final: goals.length === expectedGoals,
      has_situation_codes: goals.length > 0 ? goals.every((g) => g.situation_code) : plays.some((p) => p.situationCode),
      has_shot_events: hasShotEvents,
    },
    goals,
    penalties,
    periods,
    players: [...players.values()],
    warnings,
  };
}
