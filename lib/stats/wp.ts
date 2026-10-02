// Win probability (spec section 5, V1 plus team strength). Pure functions,
// so the model is unit-tested and the live and historical versions agree.
//
// The model: from the current score and the time left in regulation, each
// team's remaining goals are Poisson at its era's scoring rate (home and
// away separately), scaled by team strength from the pregame Elo gap. That
// gives P(home ahead / tied / behind) at the end of regulation; a tie then
// resolves by the era's overtime rules (ties, 10-minute OT, sudden death,
// shootout) with rates measured from that era's games. Playoff overtime is
// sudden death until a goal. Finally an empirical correction from every
// game state since 1917 (era, minute, score margin), weighted n / (n + 200),
// fixes what the Poisson model misses (late goalie pulls, score effects).
//
// Probabilities are from the home team's side; callers flip for the away
// team ("Bruins' side" in the UI).

export type WpOutcome = { win: number; tie: number; loss: number };

export type WpEraParams = {
  homeRate: number; // home goals per regulation second (league average)
  awayRate: number;
};

export type WpTieRule = { homeWin: number; tie: number }; // what a regulation tie becomes (regular season)

export type WpParams = {
  eras: Record<string, WpEraParams>;
  tieRules: Record<string, WpTieRule>; // keyed by otFormat label
  strength: number; // kappa: log goal-rate multiplier per Elo point of gap
  blend: number; // empirical correction weight n / (n + blend)
};

const REG_SECONDS = 3600;
const MAX_GOALS = 14;

function poissonPmf(lambda: number): number[] {
  const out: number[] = [];
  let p = Math.exp(-lambda);
  for (let k = 0; k <= MAX_GOALS; k++) {
    out.push(p);
    p = (p * lambda) / (k + 1);
  }
  return out;
}

// P(final regulation margin > 0 / = 0 / < 0) from margin d now, with home
// and away expected remaining goals lh, la.
export function regulationOutcome(d: number, lh: number, la: number): WpOutcome {
  const ph = poissonPmf(lh), pa = poissonPmf(la);
  let win = 0, tie = 0, loss = 0;
  for (let i = 0; i <= MAX_GOALS; i++)
    for (let j = 0; j <= MAX_GOALS; j++) {
      const p = ph[i] * pa[j];
      const m = d + i - j;
      if (m > 0) win += p;
      else if (m === 0) tie += p;
      else loss += p;
    }
  const total = win + tie + loss; // truncation leaves a sliver; renormalize
  return { win: win / total, tie: tie / total, loss: loss / total };
}

// Team strength: home and away scoring scaled by exp(+/- kappa * gap / 2),
// gap = home rating - away rating (back-to-back penalty already applied).
export function teamRates(era: WpEraParams, gap: number, kappa: number): { home: number; away: number } {
  const f = Math.exp((kappa * gap) / 2);
  return { home: era.homeRate * f, away: era.awayRate / f };
}

export type WpState = {
  era: string;
  otRule: string; // otFormat(season).label
  playoff: boolean;
  elapsed: number; // seconds of regulation elapsed, 0..3600 (3600 once in OT)
  inOvertime: boolean;
  homeScore: number;
  awayScore: number;
  gap: number; // pregame Elo gap, home minus away (0 = no strength)
};

export function modelOutcome(s: WpState, p: WpParams): WpOutcome {
  const era = p.eras[s.era];
  const r = teamRates(era, s.gap, p.strength);
  const d = s.homeScore - s.awayScore;
  const share = r.home / (r.home + r.away); // who scores next, in sudden death
  if (s.inOvertime) {
    if (d !== 0) return d > 0 ? { win: 1, tie: 0, loss: 0 } : { win: 0, tie: 0, loss: 1 };
    if (s.playoff) return { win: share, tie: 0, loss: 1 - share };
    const rule = p.tieRules[s.otRule];
    return { win: rule.homeWin, tie: rule.tie, loss: 1 - rule.homeWin - rule.tie };
  }
  const left = Math.max(0, REG_SECONDS - s.elapsed);
  const reg = regulationOutcome(d, r.home * left, r.away * left);
  if (s.playoff) return { win: reg.win + reg.tie * share, tie: 0, loss: reg.loss + reg.tie * (1 - share) };
  const rule = p.tieRules[s.otRule];
  return { win: reg.win + reg.tie * rule.homeWin, tie: reg.tie * rule.tie, loss: reg.loss + reg.tie * (1 - rule.homeWin - rule.tie) };
}

// Empirical correction: for a cell (era, playoff, minute, margin clipped to
// +/-3), the observed home win and loss rates over n games, compared with
// the strength-free model's prediction for the same cell.
export type WpCell = { n: number; win: number; loss: number; modelWin: number; modelLoss: number };
export const cellKey = (era: string, playoff: boolean, minute: number, margin: number) => `${era}|${playoff ? "P" : "R"}|${minute}|${Math.max(-3, Math.min(3, margin))}`;

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const clamp = (p: number) => Math.min(1 - 1e-6, Math.max(1e-6, p));

export function winProbability(s: WpState, p: WpParams, table: Map<string, WpCell>): WpOutcome {
  const m = modelOutcome(s, p);
  if (s.inOvertime || s.elapsed >= REG_SECONDS) return m;
  const minute = Math.floor(s.elapsed / 60), margin = s.homeScore - s.awayScore;
  const cell = table.get(cellKey(s.era, s.playoff, minute, margin));
  if (!cell || cell.n === 0) return m;
  // The weight uses the games in the surrounding five minutes, so it
  // doesn't jump between thin neighbouring cells (that made a lead's chance
  // dip from one minute to the next in rare playoff states).
  let pooled = 0;
  for (let k = Math.max(0, minute - 2); k <= Math.min(59, minute + 2); k++) pooled += table.get(cellKey(s.era, s.playoff, k, margin))?.n ?? 0;
  const w = pooled / 5 / (pooled / 5 + p.blend);
  // Shift the model's log-odds by the cell's observed-vs-model difference.
  const adj = (model: number, obs: number, cellModel: number) => sigmoid(logit(clamp(model)) + w * (logit(clamp(obs)) - logit(clamp(cellModel))));
  let win = adj(m.win, cell.win, cell.modelWin);
  // No ties possible (playoffs, 2005-06 on): the loss is the rest.
  if (m.tie === 0) return { win, tie: 0, loss: 1 - win };
  let loss = adj(m.loss, cell.loss, cell.modelLoss);
  if (win + loss > 1) {
    const t = win + loss;
    win /= t;
    loss /= t;
  }
  return { win, tie: Math.max(0, 1 - win - loss), loss };
}
