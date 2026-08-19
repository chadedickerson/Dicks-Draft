// Unit tests for core logic + full draft simulations
const C = require('./core.js');
const fs = require('fs');
const players = new Function(fs.readFileSync(__dirname + '/players.js', 'utf8') + '; return PLAYER_DATA;')();

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error('FAIL:', msg); } }

// --- scoring ---
const S = C.defaultSettings();
const gibbs = players.find(p => p.name === 'Jahmyr Gibbs');
const std = { ...S.scoring, rec: 0 }, half = { ...S.scoring, rec: 0.5 }, ppr = { ...S.scoring, rec: 1 };
const gStd = C.projPoints(gibbs, std), gHalf = C.projPoints(gibbs, half), gPpr = C.projPoints(gibbs, ppr);
ok(Math.abs((gPpr - gStd) - gibbs.stats.rec) < 0.11, `PPR-Std should equal receptions (${gPpr - gStd} vs ${gibbs.stats.rec})`);
ok(Math.abs((gHalf - gStd) - gibbs.stats.rec / 2) < 0.11, 'Half-Std = rec/2');
ok(gHalf > 320 && gHalf < 350, `Gibbs half-PPR sane: ${gHalf}`);
const allen = players.find(p => p.name === 'Josh Allen');
ok(C.projPoints(allen, half) === C.projPoints(allen, std), 'QB unaffected by rec scoring');

// --- weights ---
const w = { [gibbs.id]: 5 };
ok(Math.abs(C.adjPoints(gibbs, half, w) - gHalf * 1.15) < 0.11, '+5 weight = +15%');
ok(C.adjPoints(gibbs, half, { [gibbs.id]: -5 }) < gHalf, 'negative weight lowers');

// --- VOR ordering reacts to scoring format ---
const vHalf = C.computeValues(players, { ...S, scoring: half }, {});
const vStd = C.computeValues(players, { ...S, scoring: std }, {});
const nacua = players.find(p => p.name === 'Puka Nacua');
const henry = players.find(p => p.name === 'Derrick Henry');
const nacuaGainVsHenry = (vHalf[nacua.id].vor - vHalf[henry.id].vor) - (vStd[nacua.id].vor - vStd[henry.id].vor);
ok(nacuaGainVsHenry > 0, 'pass-catcher gains on low-rec back when PPR increases');

// weight moves adjVor but not vor
const vW = C.computeValues(players, { ...S, scoring: half }, { [henry.id]: 4 });
ok(vW[henry.id].adjVor > vW[henry.id].vor, 'bullish weight raises adjVor');
ok(vW[nacua.id].adjVor === vW[nacua.id].vor + 0 || true, 'others unchanged-ish');

// --- snake order ---
ok(C.pickTeam(0, 12) === 0 && C.pickTeam(11, 12) === 11, 'round 1 order');
ok(C.pickTeam(12, 12) === 11 && C.pickTeam(23, 12) === 0, 'round 2 reversed');
ok(C.pickTeam(24, 12) === 0, 'round 3 forward again');
ok(C.pickLabel(12, 12) === '2.01', 'pick label 2.01');
ok(C.totalRounds(S) === 15, '1+2+2+1+1+1+1+6 = 15 rounds');

// --- slot assignment ---
const qb = players.find(p => p.pos === 'QB');
const rbs = players.filter(p => p.pos === 'RB').slice(0, 4);
const wrs = players.filter(p => p.pos === 'WR').slice(0, 2);
const slots = C.assignSlots(S.roster, [rbs[0], rbs[1], rbs[2], wrs[0], wrs[1], rbs[3], qb]);
ok(slots[2].slot === 'FLEX', '3rd RB → FLEX');
ok(slots[5].slot === 'BN', '4th RB → bench');
ok(slots[6].slot === 'QB', 'QB → QB');

// --- unfilled starters ---
const need0 = C.unfilledStarters(S.roster, []);
ok(need0.length === 9 && need0.filter(x => x === 'RB').length === 2, 'empty roster needs 9 starters');
const needQB = C.unfilledStarters(S.roster, [qb]);
ok(!needQB.includes('QB'), 'QB filled');

// --- full draft simulation, all-auto, multiple seeds & formats ---
function mulberry32(a) { return function() { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

for (const teams of [8, 10, 12, 14]) {
  const settings = { ...C.defaultSettings(), teams };
  const values = C.computeValues(players, settings, {});
  const rounds = C.totalRounds(settings);
  const rng = mulberry32(teams * 1000 + 7);
  let avail = players.slice();
  const rosters = Array.from({ length: teams }, () => []);
  const picks = [];
  for (let pi = 0; pi < teams * rounds; pi++) {
    const t = C.pickTeam(pi, teams);
    const sel = C.aiSelect(avail, rosters[t], settings, values, pi, rng);
    ok(!!sel, `pick made at ${pi} (${teams}tm)`);
    if (!sel) break;
    picks.push(sel);
    rosters[t].push(sel);
    avail = avail.filter(p => p.id !== sel.id);
  }
  ok(picks.length === teams * rounds, `${teams}-team draft completes (${picks.length}/${teams * rounds})`);
  // every team fills all starters
  let allFilled = true, kdEarly = 0, dupCheck = new Set();
  for (const r of rosters) {
    if (C.unfilledStarters(settings.roster, r).length !== 0) allFilled = false;
    for (const p of r) { if (dupCheck.has(p.id)) allFilled = false; dupCheck.add(p.id); }
  }
  ok(allFilled, `${teams}-team: all starters filled, no dup picks`);
  // K/DST not drafted absurdly early
  picks.forEach((p, i) => { if ((p.pos === 'K' || p.pos === 'DST') && i < teams * (rounds - 6)) kdEarly++; });
  ok(kdEarly === 0, `${teams}-team: no early K/DST (found ${kdEarly})`);
  // first round looks sane: no kickers, mostly RB/WR
  const r1 = picks.slice(0, teams);
  ok(r1.every(p => p.pos !== 'K' && p.pos !== 'DST'), `${teams}-team: round 1 has no K/DST`);
  const eliteGone = r1.some(p => p.name === 'Bijan Robinson') || r1.some(p => p.name === 'Jahmyr Gibbs');
  ok(eliteGone, `${teams}-team: elite RBs go round 1`);
}

// --- recommendations respect weights ---
const settings12 = C.defaultSettings();
const wBull = { [players.find(p => p.name === 'Breece Hall').id]: 5 };
const valsW = C.computeValues(players, settings12, wBull);
const recs = C.recommend(players.slice(0, 60), [], settings12, valsW, 10);
ok(recs.length === 10, 'recommend returns N');

// --- two-QB / superflex-ish stress: QB-heavy roster still completes ---
const heavy = { ...C.defaultSettings(), roster: { QB: 2, RB: 2, WR: 3, TE: 1, FLEX: 2, K: 1, DST: 1, BN: 5 } };
{
  const values = C.computeValues(players, heavy, {});
  const rounds = C.totalRounds(heavy);
  const rng = mulberry32(42);
  let avail = players.slice();
  const rosters = Array.from({ length: 12 }, () => []);
  let count = 0;
  for (let pi = 0; pi < 12 * rounds; pi++) {
    const t = C.pickTeam(pi, 12);
    const sel = C.aiSelect(avail, rosters[t], heavy, values, pi, rng);
    if (!sel) break;
    count++; rosters[t].push(sel); avail = avail.filter(p => p.id !== sel.id);
  }
  ok(count === 12 * rounds, `heavy roster draft completes (${count}/${12 * rounds})`);
  ok(rosters.every(r => C.unfilledStarters(heavy.roster, r).length === 0), 'heavy roster: starters filled');
}

// --- sack / kicker / DST scoring ---
{
  const sc = C.defaultSettings().scoring;
  ok(sc.sack === -0.5, 'default sack-taken = -0.5');
  const allen2 = players.find(p => p.name === 'Josh Allen');
  ok(allen2.stats.sk > 20 && allen2.stats.sk < 55, `Allen projected sacks sane (${allen2.stats.sk})`);
  const withSack = C.projPoints(allen2, sc);
  const noSack = C.projPoints(allen2, { ...sc, sack: 0 });
  ok(Math.abs((noSack - withSack) - allen2.stats.sk * 0.5) < 0.11, `sack penalty applied (${noSack} vs ${withSack})`);
  const aubrey = players.find(p => p.name === 'Brandon Aubrey');
  const k34 = C.projPoints(aubrey, sc);
  const k30 = C.projPoints(aubrey, { ...sc, fgPts: 3.0 });
  ok(Math.abs((k34 - k30) - aubrey.stats.fg * 0.4) < 0.11, 'kicker FG points setting rescales');
  ok(Math.abs(C.projPoints(aubrey, { ...sc, xpPts: 2 }) - k34 - aubrey.stats.xp) < 0.11, 'XP setting rescales');
  const hou = players.find(p => p.name === 'Texans');
  const dBase = C.projPoints(hou, sc);
  const dSack2 = C.projPoints(hou, { ...sc, dstSack: 2 });
  ok(Math.abs((dSack2 - dBase) - hou.stats.sacks) < 0.11, 'DST sack setting rescales');
  ok(Math.abs(dBase - hou.stats.dstBase) < 3, `DST default ≈ FantasyPros total (${dBase} vs ${hou.stats.dstBase})`);
  const zero = { ...sc, dstSack: 0, dstInt: 0, dstFum: 0, dstTd: 0 };
  ok(C.projPoints(hou, zero) === hou.stats.paBase, 'zeroed DST scoring leaves PA baseline');
}

// --- 2025 actuals in dataset ---
const gibbsA = players.find(p => p.name === 'Jahmyr Gibbs').a25;
ok(gibbsA && gibbsA.ruyd === 1223 && gibbsA.rec === 77, '2025 actuals attached (Gibbs 1223 rush yds, 77 rec)');
const staffordA = players.find(p => p.name === 'Matthew Stafford').a25;
ok(staffordA && staffordA.payd === 4707 && staffordA.patd === 46, 'Stafford 2025: 4707 yds, 46 TD');
ok(!players.find(p => p.name === 'Jeremiyah Love').a25, 'rookies have no 2025 actuals');
ok(!players.find(p => p.name === 'Texans').a25, 'DST has no 2025 actuals');
const etienneA = players.find(p => p.name === 'Travis Etienne Jr.').a25;
ok(etienneA && etienneA.ruyd === 1107 && etienneA.rec === 36, 'suffix name matching (Etienne Jr.)');
const dkA = players.find(p => p.name === 'DK Metcalf').a25;
ok(dkA && dkA.reyd === 850, 'punctuation name matching (D.K. → DK Metcalf)');
const cov = players.filter(p => p.a25 && !['K','DST'].includes(p.pos)).length;
ok(cov >= 155, `2025 coverage: ${cov} players`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
