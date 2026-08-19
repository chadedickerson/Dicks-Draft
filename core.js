// ===== Core logic (pure — no DOM). Unit-testable in Node. =====

const SCORING_PRESETS = {
  standard: { name: 'Standard',  rec: 0   },
  half:     { name: 'Half PPR',  rec: 0.5 },
  ppr:      { name: 'Full PPR',  rec: 1   },
};

function defaultSettings() {
  return {
    preset: 'half',
    scoring: {
      payd: 0.04, patd: 4, int: -1, ruyd: 0.1, rutd: 6, rec: 0.5, reyd: 0.1, retd: 6, fum: -2,
      sack: -0.5,                                  // per sack TAKEN by your QB
      fg019: 3, fg2029: 3, fg3039: 3, fg4049: 4, fg50: 5,  // FG made by distance
      fgm019: 0, fgm2029: 0,                       // FG missed penalties (short misses)
      xpPts: 1,                                    // XP made
      dstSack: 1, dstInt: 2, dstFum: 2, dstTd: 6,  // team defense
    },
    teams: 12,
    userSlot: 5,
    roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 6 },
  };
}

function totalRounds(settings) {
  const r = settings.roster;
  return r.QB + r.RB + r.WR + r.TE + r.FLEX + r.K + r.DST + r.BN;
}

// --- Scoring ---
function projPoints(player, scoring) {
  const s = player.stats;
  if (player.pos === 'K') {
    const g = (k, d) => scoring[k] != null ? scoring[k] : d;
    return round1(
      (s.fg019 || 0) * g('fg019', 3) + (s.fg2029 || 0) * g('fg2029', 3) + (s.fg3039 || 0) * g('fg3039', 3) +
      (s.fg4049 || 0) * g('fg4049', 4) + (s.fg50 || 0) * g('fg50', 5) +
      (s.fgm019 || 0) * g('fgm019', 0) + (s.fgm2029 || 0) * g('fgm2029', 0) +
      s.xp * g('xpPts', 1)
    );
  }
  if (player.pos === 'DST') return round1(
    (s.paBase || 0) +
    s.sacks * (scoring.dstSack != null ? scoring.dstSack : 1) +
    s.dint  * (scoring.dstInt  != null ? scoring.dstInt  : 2) +
    s.fumrec * (scoring.dstFum != null ? scoring.dstFum : 2) +
    s.dtd   * (scoring.dstTd   != null ? scoring.dstTd   : 6)
  );
  return round1(
    (s.payd || 0) * scoring.payd + (s.patd || 0) * scoring.patd + (s.int || 0) * scoring.int +
    (s.ruyd || 0) * scoring.ruyd + (s.rutd || 0) * scoring.rutd +
    (s.rec  || 0) * scoring.rec  + (s.reyd || 0) * scoring.reyd + (s.retd || 0) * scoring.retd +
    (s.fum  || 0) * scoring.fum  + (s.sk   || 0) * (scoring.sack || 0)
  );
}
function round1(x) { return Math.round(x * 10) / 10; }

// Weight step (-5..+5) → points multiplier (±3% per step)
const WEIGHT_PCT = 0.03;
function adjPoints(player, scoring, weights) {
  const w = weights[player.id] || 0;
  return round1(projPoints(player, scoring) * (1 + w * WEIGHT_PCT));
}

// --- Value Over Replacement ---
// Replacement rank per position derived from league size + roster shape.
function replacementRanks(settings) {
  const t = settings.teams, r = settings.roster;
  return {
    QB:  Math.round(t * (r.QB + 0.15)),
    RB:  Math.round(t * (r.RB + r.FLEX * 0.45 + 0.4)),
    WR:  Math.round(t * (r.WR + r.FLEX * 0.45 + 0.4)),
    TE:  Math.round(t * (r.TE + r.FLEX * 0.10 + 0.15)),
    K:   t,
    DST: t,
  };
}

// Compute {id → {proj, adj, vor, adjVor}} for all players.
function computeValues(players, settings, weights) {
  const repl = replacementRanks(settings);
  const byPos = {};
  for (const p of players) (byPos[p.pos] = byPos[p.pos] || []).push(p);
  const baseline = {}, adjBaseline = {};
  for (const pos of Object.keys(byPos)) {
    const base = byPos[pos].map(p => projPoints(p, settings.scoring)).sort((a, b) => b - a);
    const adj  = byPos[pos].map(p => adjPoints(p, settings.scoring, weights)).sort((a, b) => b - a);
    const idx = Math.min(repl[pos] - 1, base.length - 1);
    baseline[pos] = base[Math.max(0, idx)];
    adjBaseline[pos] = adj[Math.max(0, idx)];
  }
  const out = {};
  for (const p of players) {
    const proj = projPoints(p, settings.scoring);
    const adj = adjPoints(p, settings.scoring, weights);
    out[p.id] = {
      proj, adj,
      vor: round1(proj - baseline[p.pos]),
      adjVor: round1(adj - adjBaseline[p.pos]),
    };
  }
  return out;
}

// --- Snake draft ---
function pickTeam(pickIndex, teams) { // 0-based pick index → 0-based team index
  const round = Math.floor(pickIndex / teams);
  const i = pickIndex % teams;
  return round % 2 === 0 ? i : teams - 1 - i;
}
function pickLabel(pickIndex, teams) {
  const round = Math.floor(pickIndex / teams) + 1;
  return round + '.' + String((pickIndex % teams) + 1).padStart(2, '0');
}

// Assign a drafted player list to display slots (starters → FLEX → bench)
function assignSlots(roster, players) { // players in draft order
  const slots = [];
  const open = { QB: roster.QB, RB: roster.RB, WR: roster.WR, TE: roster.TE, FLEX: roster.FLEX, K: roster.K, DST: roster.DST };
  for (const p of players) {
    if (open[p.pos] > 0) { open[p.pos]--; slots.push({ slot: p.pos, p }); }
    else if ((p.pos === 'RB' || p.pos === 'WR' || p.pos === 'TE') && open.FLEX > 0) { open.FLEX--; slots.push({ slot: 'FLEX', p }); }
    else slots.push({ slot: 'BN', p });
  }
  return slots;
}

function posCounts(list) {
  const c = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 };
  for (const p of list) c[p.pos]++;
  return c;
}

// Unfilled *starter* slots for a team (FLEX counts RB/WR/TE overflow)
function unfilledStarters(roster, teamPlayers) {
  const c = posCounts(teamPlayers);
  const need = [];
  let flexOver = 0;
  for (const pos of ['RB', 'WR', 'TE']) {
    const over = Math.max(0, c[pos] - roster[pos]);
    flexOver += over;
  }
  for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DST']) {
    const short = Math.max(0, roster[pos] - c[pos]);
    for (let i = 0; i < short; i++) need.push(pos);
  }
  const flexShort = Math.max(0, roster.FLEX - flexOver);
  for (let i = 0; i < flexShort; i++) need.push('FLEX');
  return need; // e.g. ['RB','WR','FLEX','K','DST']
}

// --- AI drafting brain ---
// AI teams draft off consensus (ADP + base VOR) with need logic + randomness.
// `rng` is injectable for testability.
function aiSelect(available, teamPlayers, settings, values, pickIndex, rng) {
  rng = rng || Math.random;
  const teams = settings.teams;
  const roster = settings.roster;
  const round = Math.floor(pickIndex / teams) + 1;
  const rounds = totalRounds(settings);
  const picksLeft = rounds - round + 1; // including this one
  const c = posCounts(teamPlayers);
  const need = unfilledStarters(roster, teamPlayers);
  const needSet = new Set(need);

  const caps = {
    QB: roster.QB + 1, TE: roster.TE + 1, K: roster.K, DST: roster.DST,
    RB: 99, WR: 99,
  };
  const lateOnly = { K: true, DST: true };

  const eligible = available.filter(p => {
    if (c[p.pos] >= caps[p.pos]) return false;
    // K/DST: only when needed and late (last ~3 rounds), or forced
    if (lateOnly[p.pos]) {
      if (!needSet.has(p.pos)) return false;
      if (picksLeft > need.length + 2) return false;
    }
    // 2nd QB/TE only after starters mostly filled or late
    if (p.pos === 'QB' && c.QB >= roster.QB && round < rounds - 4) return false;
    if (p.pos === 'TE' && c.TE >= roster.TE && round < rounds - 4) return false;
    return true;
  });

  // Endgame: if picks remaining == starter needs, only fill needs
  let pool = eligible;
  if (picksLeft <= need.length) {
    pool = eligible.filter(p =>
      needSet.has(p.pos) ||
      (needSet.has('FLEX') && (p.pos === 'RB' || p.pos === 'WR' || p.pos === 'TE')));
    if (pool.length === 0) pool = eligible;
  }
  if (pool.length === 0) pool = available;

  // Scarcity: how many remain at each pos vs how many starter slots the
  // league still needs there. If a needed position is drying up, act now.
  const remaining = posCounts(available);

  // Rank by ADP, take a window, score by base VOR + need bonus + jitter
  const window = pool.slice().sort((a, b) => a.adp - b.adp).slice(0, 10);
  // Make sure scarce needed positions are represented in the window
  for (const pos of needSet) {
    if (pos === 'FLEX' || lateOnly[pos]) continue;
    if (remaining[pos] <= teams * 1.25 && !window.some(p => p.pos === pos)) {
      const top = available.filter(p => p.pos === pos).sort((a, b) => a.adp - b.adp).slice(0, 2);
      window.push(...top);
    }
  }
  let best = null, bestScore = -Infinity;
  for (const p of window) {
    const v = values[p.id];
    let score = v.vor;
    if (needSet.has(p.pos)) {
      score += 6;
      if (remaining[p.pos] <= teams * 1.25) score += 30; // pool drying up — fill it now
    }
    else if (needSet.has('FLEX') && (p.pos === 'RB' || p.pos === 'WR')) score += 3;
    score += (p.adp - pickIndex - 1) < -12 ? -8 : 0; // don't reach past big faller? (falling player = bonus actually)
    score += rng() * 10; // jitter → drafts differ run to run
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best || pool[0];
}

// Recommendations for the human: adjusted VOR (their weights), need-aware
function recommend(available, teamPlayers, settings, values, count) {
  const need = new Set(unfilledStarters(settings.roster, teamPlayers));
  return available.slice()
    .sort((a, b) => {
      const sa = values[a.id].adjVor + (need.has(a.pos) ? 4 : 0);
      const sb = values[b.id].adjVor + (need.has(b.pos) ? 4 : 0);
      return sb - sa;
    })
    .slice(0, count || 5);
}

if (typeof module !== 'undefined') {
  module.exports = { SCORING_PRESETS, defaultSettings, totalRounds, projPoints, adjPoints, computeValues, replacementRanks, pickTeam, pickLabel, assignSlots, posCounts, unfilledStarters, aiSelect, recommend, WEIGHT_PCT };
}
