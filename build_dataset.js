// Builds players.js — the embedded dataset for the draft board app.
// Sources (fetched Aug 14, 2026):
//  - Rank order + teams: SI 2026 top-200 (consensus seasonal rankings)
//  - Stat anchors: FantasyPros season projections (their numbers average
//    multiple sites: ESPN, CBS, NFL.com, Yahoo, numberFire, etc.)
//  - Bye weeks: SI 2026 bye week schedule
// Non-anchored players get stat lines generated from position-rank point
// curves calibrated to the anchors, so Std/Half/Full PPR all recompute
// sensibly from stats.

const fs = require('fs');

const BYES = { ARI:14, ATL:11, BAL:13, BUF:7, CAR:5, CHI:10, CIN:6, CLE:11, DAL:14, DEN:10, DET:6, GB:11, HOU:8, IND:13, JAC:7, KC:5, LAC:7, LAR:11, LV:13, MIA:6, MIN:6, NE:11, NO:8, NYG:8, NYJ:13, PHI:10, PIT:9, SEA:11, SF:8, TB:10, TEN:9, WAS:7 };

// ---- FantasyPros multi-site averaged anchors ----
const QB_ANCHORS = {
  'josh allen':        { payd:3817, patd:27.4, int:11.2, ruyd:586, rutd:11.8 },
  'lamar jackson':     { payd:3653, patd:28.3, int:9.6,  ruyd:640, rutd:3.2 },
  'drake maye':        { payd:4026, patd:28.0, int:10.4, ruyd:493, rutd:3.7 },
  'jayden daniels':    { payd:3682, patd:23.8, int:11.0, ruyd:686, rutd:4.7 },
  'jalen hurts':       { payd:3571, patd:24.2, int:7.4,  ruyd:461, rutd:8.4 },
  'joe burrow':        { payd:4170, patd:33.3, int:11.6, ruyd:179, rutd:1.4 },
  'jaxson dart':       { payd:3592, patd:22.3, int:11.1, ruyd:549, rutd:6.5 },
  'brock purdy':       { payd:4154, patd:27.7, int:14.3, ruyd:304, rutd:3.8 },
  'dak prescott':      { payd:4294, patd:30.9, int:11.3, ruyd:173, rutd:1.7 },
  'trevor lawrence':   { payd:3909, patd:26.9, int:13.0, ruyd:322, rutd:4.9 },
};
const RB_ANCHORS = {
  'jahmyr gibbs':        { ruatt:275, ruyd:1383, rutd:13.8, rec:70.9, reyd:581, retd:4.1 },
  'bijan robinson':      { ruatt:290, ruyd:1427, rutd:9.5,  rec:79.6, reyd:736, retd:3.8 },
  'christian mccaffrey': { ruatt:269, ruyd:1093, rutd:8.7,  rec:78.4, reyd:694, retd:4.6 },
  'jonathan taylor':     { ruatt:327, ruyd:1508, rutd:12.9, rec:45.1, reyd:339, retd:1.5 },
  'derrick henry':       { ruatt:314, ruyd:1568, rutd:13.4, rec:17.8, reyd:171, retd:0.7 },
  "de'von achane":       { ruatt:238, ruyd:1199, rutd:6.0,  rec:65.3, reyd:491, retd:4.0 },
  'james cook':          { ruatt:288, ruyd:1404, rutd:10.3, rec:33.3, reyd:284, retd:1.9 },
  'ashton jeanty':       { ruatt:282, ruyd:1108, rutd:8.0,  rec:58.7, reyd:414, retd:3.3 },
  'chase brown':         { ruatt:239, ruyd:1040, rutd:7.8,  rec:63.7, reyd:427, retd:3.9 },
  'saquon barkley':      { ruatt:296, ruyd:1299, rutd:8.2,  rec:41.7, reyd:330, retd:2.1 },
};
const WR_ANCHORS = {
  'puka nacua':          { rec:117.0, reyd:1539, retd:9.0,  ruyd:85, rutd:1.4 },
  "ja'marr chase":       { rec:121.1, reyd:1510, retd:10.6, ruyd:17, rutd:0 },
  'jaxon smith-njigba':  { rec:110.9, reyd:1570, retd:9.2,  ruyd:30, rutd:0.1 },
  'amon-ra st. brown':   { rec:117.3, reyd:1391, retd:10.5, ruyd:12, rutd:0 },
  'drake london':        { rec:101.7, reyd:1328, retd:9.4,  ruyd:0,  rutd:0 },
  'ceedee lamb':         { rec:97.6,  reyd:1297, retd:7.5,  ruyd:13, rutd:0 },
  'rashee rice':         { rec:99.1,  reyd:1100, retd:9.7,  ruyd:26, rutd:0.9 },
  'justin jefferson':    { rec:98.6,  reyd:1311, retd:7.1,  ruyd:6,  rutd:0 },
  'a.j. brown':          { rec:87.7,  reyd:1222, retd:7.6,  ruyd:0,  rutd:0 },
  'george pickens':      { rec:82.6,  reyd:1201, retd:8.4,  ruyd:0,  rutd:0 },
};
const TE_ANCHORS = {
  'trey mcbride':      { rec:109.0, reyd:1052, retd:6.8 },
  'brock bowers':      { rec:96.5,  reyd:1026, retd:7.5 },
  'colston loveland':  { rec:78.7,  reyd:929,  retd:6.7 },
  'tyler warren':      { rec:83.0,  reyd:873,  retd:5.4 },
  'kyle pitts':        { rec:79.5,  reyd:881,  retd:4.7 },
  'harold fannin':     { rec:78.3,  reyd:815,  retd:5.4 },
  'sam laporta':       { rec:70.4,  reyd:813,  retd:5.5 },
  'dallas goedert':    { rec:65.5,  reyd:689,  retd:7.6 },
  'tucker kraft':      { rec:60.2,  reyd:771,  retd:6.4 },
  'travis kelce':      { rec:74.9,  reyd:785,  retd:4.8 },
};
const K_ANCHORS = [ // ordered
  ['Brandon Aubrey','DAL',35.2,47.5], ['Jason Myers','SEA',34.7,46.3], ["Ka'imi Fairbairn",'HOU',36.3,35.6],
  ['Cameron Dicker','LAC',34.7,40.2], ['Harrison Mevis','LAR',27.3,54.9], ['Jake Bates','DET',28.3,51.1],
  ['Blake Grupe','IND',30.2,42.9], ['Chase McLaughlin','TB',31.5,38.4], ['Cairo Santos','CHI',30.0,42.9],
  ['Eddy Pineiro','SF',31.0,39.5],
];
const DST_ANCHORS = [ // ordered: name, team, sacks, ints, fumrec, tds, basePts
  ['Texans','HOU',49.6,14.8,11.6,2.8,121.2], ['Broncos','DEN',59.6,13.3,8.3,2.4,118.1],
  ['Steelers','PIT',45.9,13.6,12.8,2.4,113.4], ['Vikings','MIN',49.3,12.6,12.1,2.3,112.6],
  ['Seahawks','SEA',46.5,13.6,8.4,3.2,110.9], ['Chargers','LAC',48.9,15.3,8.7,2.0,108.7],
  ['Rams','LAR',46.5,13.4,9.5,2.4,107.5], ['Lions','DET',48.0,13.4,9.3,2.2,107.5],
  ['Bills','BUF',42.8,14.6,9.6,2.4,106.7], ['Eagles','PHI',42.4,13.0,10.0,2.4,102.8],
];

// ---- Position point curves (half-PPR targets by positional rank) ----
// Anchored to FantasyPros top-10 values, extended with typical decay.
const CURVES = {
  QB: [[1,372],[5,320],[10,306],[12,292],[15,272],[20,246],[25,220],[30,192],[35,165]],
  RB: [[1,337],[5,264],[10,244],[15,214],[20,193],[25,175],[30,158],[35,143],[40,128],[50,104],[60,84],[70,68],[80,55]],
  WR: [[1,281],[5,238],[10,211],[15,193],[20,178],[25,166],[30,154],[40,131],[50,111],[60,94],[70,79],[80,66]],
  TE: [[1,200],[5,156],[10,144],[15,118],[20,98],[25,83],[30,70]],
  K:  [[1,153],[5,137],[10,133],[15,124],[20,116]],
  DST:[[1,121],[5,111],[10,103],[15,96],[20,89]],
};
function curvePts(pos, rank) {
  const c = CURVES[pos];
  if (rank <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (rank <= c[i][0]) {
      const [r0,p0] = c[i-1], [r1,p1] = c[i];
      return p0 + (p1-p0) * (rank-r0)/(r1-r0);
    }
  }
  const [r0,p0] = c[c.length-2], [r1,p1] = c[c.length-1];
  return Math.max(20, p1 + (p1-p0)/(r1-r0) * (rank-r1));
}

// Deterministic per-player variance in [0,1)
function hash01(s) {
  let h = 2166136261;
  for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}
function norm(name) {
  return name.toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\.?$/,'').replace(/[.,']/g,"'".replace("'","")).replace(/[.,]/g,'').trim();
}
function nkey(name) {
  return name.toLowerCase().replace(/[.,']/g,'').replace(/\s+(jr|sr|ii|iii|iv|v)$/,'').trim();
}

// ---- Stat line generators (target P is half-PPR points) ----
function genQB(P, h) {
  const rushShare = 0.06 + h*0.20; // 6%..26% of points from rushing
  let ruyd = Math.min(750, rushShare * P / 0.145);
  let rutd = ruyd / 160;
  const rushPts = ruyd*0.1 + rutd*6;
  const coef = 0.04 + 4/148 - 1/360; // payd + patd(payd/148) - int(payd/360)
  const payd = Math.max(2400, (P - rushPts) / coef);
  return { payd: Math.round(payd), patd: +(payd/148).toFixed(1), int: +(payd/360).toFixed(1),
           ruyd: Math.round(ruyd), rutd: +rutd.toFixed(1), fum: 3, sk: qbSacks(payd, h) };
}
// Projected sacks taken: scales with dropback volume, varied per QB profile
function qbSacks(payd, h) { return Math.round(payd / 130 + 5 + h * 10); }
function genRB(P, h) {
  const catchShare = 0.14 + h*0.30; // 14%..44% of half-PPR pts from receiving
  const recPts = catchShare * P, rushPts = P - recPts;
  const rec = recPts / 1.55;             // rec*(0.5 + 7.8*0.1 + 6/22)
  const reyd = rec * 7.8, retd = rec / 22;
  const ruyd = rushPts / 0.1444;         // ruyd*(0.1 + 6/138)
  const rutd = ruyd / 138;
  return { ruatt: Math.round(ruyd/4.3), ruyd: Math.round(ruyd), rutd: +rutd.toFixed(1),
           rec: +rec.toFixed(1), reyd: Math.round(reyd), retd: +retd.toFixed(1), fum: 2 };
}
function genWR(P, h) {
  const ypr = 11.0 + h*3.5;
  const rec = P / (0.5 + ypr*0.1 + ypr*6/195);
  const reyd = rec * ypr, retd = reyd / 195;
  return { rec: +rec.toFixed(1), reyd: Math.round(reyd), retd: +retd.toFixed(1), ruyd: 0, rutd: 0, fum: 1 };
}
function genTE(P, h) {
  const ypr = 9.5 + h*2.2;
  const rec = P / (0.5 + ypr*0.1 + ypr*6/155);
  const reyd = rec * ypr, retd = reyd / 155;
  return { rec: +rec.toFixed(1), reyd: Math.round(reyd), retd: +retd.toFixed(1), fum: 1 };
}
function genK(P) {
  // P ≈ fg*3.35 + xp, keep fg/xp ratio like league median
  const fg = P / 4.6, xp = P - fg*3.35;
  return { fg: +fg.toFixed(1), xp: +xp.toFixed(1) };
}
// Split a kicker's projected FG total into distance buckets using league-wide
// make distribution (≈3% 0-19, 25% 20-29, 28% 30-39, 28% 40-49, 16% 50+),
// varied slightly per kicker. Misses ≈ 17% of makes, mostly from 40+.
function kickerSplit(stats, h) {
  const F = stats.fg;
  const long = 0.16 + (h - 0.5) * 0.08;          // 50+ share: 12%..20%
  const shares = { fg019: 0.03, fg2029: 0.25, fg3039: 0.28, fg4049: 0.44 - long, fg50: long };
  const out = { fg: F, xp: stats.xp };
  for (const k of Object.keys(shares)) out[k] = +(F * shares[k]).toFixed(1);
  const misses = F * 0.17;
  out.fgm019 = +(misses * 0.02).toFixed(1);
  out.fgm2029 = +(misses * 0.06).toFixed(1);
  return out;
}
// The FantasyPros DST point total minus its stat-explained part = the
// points-allowed / misc baseline, so custom DST stat scoring stays honest.
function dstPaBase(s) {
  return Math.round((s.dstBase - (s.sacks*1 + s.dint*2 + s.fumrec*2 + s.dtd*6)) * 10) / 10;
}

// ---- Build ----
const csv = fs.readFileSync(__dirname + '/data/rankings.csv', 'utf8').trim().split('\n').slice(1);
const players = [];
const posCount = { QB:0, RB:0, WR:0, TE:0, K:0, DST:0 };
const seenNames = new Set();

for (const line of csv) {
  const [rank, name, pos, team] = line.split(',');
  posCount[pos]++;
  const posRank = posCount[pos];
  const h = hash01(name);
  const key = nkey(name);
  seenNames.add(key);
  let stats;
  if (pos === 'QB') {
    stats = QB_ANCHORS[key] ? { ...QB_ANCHORS[key], fum: 3 } : genQB(curvePts('QB', posRank), h);
    if (stats.sk == null) stats.sk = qbSacks(stats.payd, h);
  }
  else if (pos === 'RB') stats = RB_ANCHORS[key] ? { ...RB_ANCHORS[key], fum: 2 } : genRB(curvePts('RB', posRank), h);
  else if (pos === 'WR') stats = WR_ANCHORS[key] ? { ...WR_ANCHORS[key], fum: 1 } : genWR(curvePts('WR', posRank), h);
  else if (pos === 'TE') stats = TE_ANCHORS[key] ? { ...TE_ANCHORS[key], ruyd:0, rutd:0, fum: 1 } : genTE(curvePts('TE', posRank), h);
  else if (pos === 'K') {
    const a = K_ANCHORS.find(k => nkey(k[0]) === key);
    stats = kickerSplit(a ? { fg: a[2], xp: a[3] } : genK(curvePts('K', posRank)), h);
  } else { // DST
    const a = DST_ANCHORS.find(d => d[1] === team);
    stats = a ? { sacks: a[2], dint: a[3], fumrec: a[4], dtd: a[5], dstBase: a[6] }
              : { sacks: 40, dint: 11, fumrec: 8, dtd: 1.5, dstBase: curvePts('DST', posRank) };
    stats.paBase = dstPaBase(stats);
  }
  players.push({
    id: +rank, name, pos, team, bye: BYES[team] || 0,
    adp: +rank, posRank, stats,
  });
}

// ---- 2025 actual stats (Pro-Football-Reference season tables, fetched Aug 2026) ----
const actualsCsv = fs.readFileSync(__dirname + '/data/actuals_2025.csv', 'utf8').trim().split('\n').slice(1);
const actuals = {}; // nkey -> {payd,patd,ruyd,rutd,rec,reyd,retd}
for (const line of actualsCsv) {
  const [cat, name, v1, v2, v3] = line.split(',');
  const k = nkey(name);
  actuals[k] = actuals[k] || {};
  if (cat === 'pass') { actuals[k].payd = +v1; actuals[k].patd = +v2; }
  else if (cat === 'rush') { actuals[k].ruyd = +v1; actuals[k].rutd = +v2; }
  else { actuals[k].rec = +v1; actuals[k].reyd = +v2; actuals[k].retd = +v3; }
}
let matched25 = 0;
for (const p of players) {
  if (p.pos === 'K' || p.pos === 'DST') continue;
  const a = actuals[nkey(p.name)];
  if (a) { p.a25 = a; matched25++; }
}
console.log('2025 actuals matched:', matched25, 'players');

// ---- Depth pool (ranks 201-270): real players from 2025 PFR stat tables +
// known handcuffs. Teams = last confirmed; the in-app Sleeper sync corrects
// team/bye live, so stale assignments self-heal. ----
const DEPTH = [
  // QB
  ['Tua Tagovailoa','QB','MIA'],['Michael Penix Jr.','QB','ATL'],['Anthony Richardson','QB','IND'],
  ['Justin Fields','QB','NYJ'],['Geno Smith','QB','LV'],['Joe Flacco','QB','CLE'],['Russell Wilson','QB','NYG'],
  // RB
  ['Kareem Hunt','RB','KC'],['Nick Chubb','RB','HOU'],['Devin Singletary','RB','NYG'],['Emanuel Wilson','RB','GB'],
  ['Ollie Gordon II','RB','MIA'],['Devin Neal','RB','NO'],['Kendre Miller','RB','NO'],['Audric Estime','RB','DEN'],
  ['Brashard Smith','RB','KC'],['Isaiah Davis','RB','NYJ'],['Jeremy McNichols','RB','WAS'],['Emari Demercado','RB','ARI'],
  ['Jaleel McLaughlin','RB','DEN'],['Antonio Gibson','RB','NE'],['Jerome Ford','RB','CLE'],['LeQuint Allen','RB','JAC'],
  ['Trey Benson','RB','ARI'],['Isaac Guerendo','RB','SF'],['Roschon Johnson','RB','CHI'],['Ty Chandler','RB','MIN'],
  ['MarShawn Lloyd','RB','GB'],['Will Shipley','RB','PHI'],['Dameon Pierce','RB','HOU'],['Zamir White','RB','LV'],
  ['Kenny McIntosh','RB','SEA'],['Craig Reynolds','RB','DET'],['Samaje Perine','RB','CIN'],
  // WR
  ['Keenan Allen','WR','LAC'],['Troy Franklin','WR','DEN'],['Elic Ayomanor','WR','TEN'],['Sterling Shepard','WR','TB'],
  ['Olamide Zaccheaus','WR','WAS'],['Kendrick Bourne','WR','SF'],['Darius Slayton','WR','NYG'],['Ricky Pearsall','WR','SF'],
  ['Xavier Hutchinson','WR','HOU'],['Xavier Legette','WR','CAR'],['Kayshon Boutte','WR','NE'],['Andrei Iosivas','WR','CIN'],
  ['Marquise Brown','WR','KC'],['Cooper Kupp','WR','SEA'],['Chimere Dike','WR','TEN'],['Keon Coleman','WR','BUF'],
  ['Marvin Mims Jr.','WR','DEN'],['Mack Hollins','WR','NE'],['Calvin Ridley','WR','TEN'],['Adam Thielen','WR','CAR'],
  ['DeMario Douglas','WR','NE'],['Dontayvion Wicks','WR','GB'],
  // TE
  ['David Njoku','TE','CLE'],['Evan Engram','TE','DEN'],['Cade Otton','TE','TB'],['Pat Freiermuth','TE','PIT'],
  ['Theo Johnson','TE','NYG'],['Mason Taylor','TE','NYJ'],['Gunnar Helm','TE','TEN'],['Colby Parkinson','TE','LAR'],
  ['Michael Mayer','TE','LV'],['Jonnu Smith','TE','PIT'],['Noah Fant','TE','CIN'],['Jake Tonges','TE','SF'],
  ['Dawson Knox','TE','BUF'],['Zach Ertz','TE','WAS'],
];
let depthAdp = 201;
for (const [name, pos, team] of DEPTH) {
  posCount[pos]++;
  const posRank = posCount[pos];
  const h = hash01(name);
  let stats;
  if (pos === 'QB') { stats = genQB(curvePts('QB', posRank), h); }
  else if (pos === 'RB') stats = genRB(curvePts('RB', posRank), h);
  else if (pos === 'WR') stats = genWR(curvePts('WR', posRank), h);
  else stats = genTE(curvePts('TE', posRank), h);
  seenNames.add(nkey(name));
  players.push({ id: players.length + 1, name, pos, team, bye: BYES[team] || 0, adp: depthAdp++, posRank, stats, depth: true });
}
// attach 2025 actuals for depth players too
for (const p of players) {
  if (p.depth && actuals[nkey(p.name)]) { p.a25 = actuals[nkey(p.name)]; matched25++; }
}
console.log('after depth pool:', players.length, 'players');

// Append remaining K / DST so 12-team drafts can fill K + DST slots
let nextId = players.length + 1, extraAdp = depthAdp;
for (const [name, team, fg, xp] of K_ANCHORS) {
  if (seenNames.has(nkey(name))) continue;
  posCount.K++;
  players.push({ id: nextId++, name, pos: 'K', team, bye: BYES[team], adp: extraAdp++, posRank: posCount.K, stats: kickerSplit({ fg, xp }, hash01(name)) });
}
for (const [name, team, sacks, dint, fumrec, dtd, base] of DST_ANCHORS) {
  if (players.some(p => p.pos === 'DST' && p.team === team)) continue;
  posCount.DST++;
  const stats = { sacks, dint, fumrec, dtd, dstBase: base };
  stats.paBase = dstPaBase(stats);
  players.push({ id: nextId++, name, pos: 'DST', team, bye: BYES[team], adp: extraAdp++, posRank: posCount.DST, stats });
}
// A few more generated Ks/DSTs for deep leagues
const MORE_K = [['Younghoe Koo','ATL'],['Evan McPherson','CIN'],['Tyler Bass','BUF'],['Joey Slye','WAS'],['Will Reichard','MIN'],['Cam Little','JAC']];
for (const [name, team] of MORE_K) {
  posCount.K++;
  players.push({ id: nextId++, name, pos: 'K', team, bye: BYES[team], adp: extraAdp++, posRank: posCount.K, stats: kickerSplit(genK(curvePts('K', posCount.K)), hash01(name)) });
}
const MORE_DST = [['Ravens','BAL'],['Packers','GB'],['Chiefs','KC'],['49ers','SF'],['Jets','NYJ'],['Colts','IND'],['Patriots','NE'],['Cowboys','DAL']];
for (const [name, team] of MORE_DST) {
  posCount.DST++;
  const stats = { sacks: 40, dint: 11, fumrec: 8, dtd: 1.5, dstBase: curvePts('DST', posCount.DST) };
  stats.paBase = dstPaBase(stats);
  players.push({ id: nextId++, name, pos: 'DST', team, bye: BYES[team], adp: extraAdp++, posRank: posCount.DST, stats });
}

fs.writeFileSync(__dirname + '/players.js',
  '// Generated ' + '2026-08-14' + ' — consensus rank order (SI top-200) + FantasyPros multi-site\n' +
  '// averaged stat projections (anchors) with calibrated stat lines for the rest.\n' +
  'const TEAM_BYES = ' + JSON.stringify(BYES) + ';\n' +
  'const PLAYER_DATA = [\n' + players.map(p => JSON.stringify(p)).join(',\n') + '\n];\n');
console.log('Wrote', players.length, 'players.', JSON.stringify(posCount));

// Sanity: half-PPR scoring check for a few (default scoring incl. -0.5/sack)
function halfPts(p) {
  const s = p.stats;
  if (p.pos === 'K') return s.fg019*3 + s.fg2029*3 + s.fg3039*3 + s.fg4049*4 + s.fg50*5 + s.xp;
  if (p.pos === 'DST') return s.paBase + s.sacks*1 + s.dint*2 + s.fumrec*2 + s.dtd*6;
  return (s.payd||0)*0.04 + (s.patd||0)*4 - (s.int||0) + (s.ruyd||0)*0.1 + (s.rutd||0)*6
       + (s.rec||0)*0.5 + (s.reyd||0)*0.1 + (s.retd||0)*6 - (s.fum||0)*2 - (s.sk||0)*0.5;
}
for (const nm of ['Josh Allen','Jahmyr Gibbs','Puka Nacua','Trey McBride','Kenneth Walker III','Tetairoa McMillan','Alvin Kamara','Kyle Monangai']) {
  const p = players.find(x => x.name === nm);
  console.log(nm.padEnd(24), p.pos + String(p.posRank).padEnd(4), Math.round(halfPts(p)), 'half-PPR pts');
}
