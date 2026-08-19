// Unit tests for the draft assistant (runs core+playoff+assistant in one scope)
const fs = require('fs');
const vm = require('vm');
const ctx = { module: undefined, console };
vm.createContext(ctx);
for (const f of ['players.js', 'playoff.js', 'core.js', 'assistant.js']) {
  vm.runInContext(fs.readFileSync(__dirname + '/' + f, 'utf8').replace(/if \(typeof module[^]*$/m, ''), ctx);
}
// const declarations live in the context's lexical scope, not as properties —
// pull out what we need with one final expression evaluated inside the context.
const G = vm.runInContext('({ PLAYER_DATA, askAssistant, findPlayers, computeValues, defaultSettings })', ctx);
const players = G.PLAYER_DATA;

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL:', msg); } };

const settings = G.defaultSettings();
const weights = {};
const values = G.computeValues(players, settings, weights);
const order = players.slice().sort((a, b) => values[b.id].adjVor - values[a.id].adjVor);
const rankMap = {}; order.forEach((p, i) => rankMap[p.id] = i + 1);

function mkCtx(over) {
  return Object.assign({
    players, values, rankMap, settings, weights,
    available: () => players,
    rosterOf: () => [],
    onClockTeam: null, userTeam: 4, pickIndex: null, draftActive: false,
    pickedInfo: () => null,
    teamName: t => 'Team ' + (t + 1),
  }, over || {});
}
const ask = (q, c) => G.askAssistant(q, c || mkCtx()).html;

// player lookup
ok(ask('when is gibbs bye').includes('week 6'), 'Gibbs bye = 6: ' + ask('when is gibbs bye'));
ok(ask("what is ja'marr chase's bye week").includes('week 6'), "Chase bye = 6");
ok(ask('tell me about puka nacua').includes('Puka Nacua') && ask('tell me about puka nacua').includes('playoff'), 'player card w/ playoff line');

// who should I take
const who = ask('who should i take?');
ok(who.includes('1.') && who.includes('VOR'), 'who-to-take gives ranked reasons');

// best available
const rbs = ask('best rbs available');
ok(rbs.includes('Best RB') && (rbs.match(/<li/g) || []).length === 5, 'top-5 RBs list');

// playoff — player
const gp = ask("how is jahmyr gibbs' playoff schedule?");
ok(gp.includes('Week 15') && gp.includes('@MIN'), 'Gibbs playoff detail shows W15 @MIN: ' + gp.slice(0, 140));
ok(gp.includes('brutal') || gp.includes('tough'), 'W15 @MIN flagged tough');

// playoff — position
const pw = ask('best playoff wrs');
ok(pw.includes('WR') && pw.includes('SOS rank'), 'playoff WRs list has SOS ranks');

// playoff — general
const pg = ask('who has favorable playoff matchups?');
ok(pg.includes('JAC') && pg.includes('SF'), 'general playoff answer names best (JAC) and worst (SF)');

// compare
const cmp = ask('gibbs or bijan?');
ok(cmp.includes('Jahmyr Gibbs') && cmp.includes('Bijan Robinson') && cmp.includes('VOR'), 'compare works');

// bye week N
const b7 = ask('who has bye week 7?');
ok(b7.includes('week 7'), 'bye-week-7 list');

// roster bye conflicts (with a fake roster)
const roster = [players[0], players[1], players[8]]; // Bijan(11), Gibbs(6), ARSB(6)... ids 1,2,9
const cb = ask('bye conflicts on my roster', mkCtx({ rosterOf: () => roster }));
ok(cb.includes('Week 6') || cb.includes('Week 11'), 'roster bye summary: ' + cb.slice(0, 120));

// when should I draft a QB (mid-draft)
const wq = ask('when should i draft a qb?', mkCtx({ draftActive: true, pickIndex: 30, onClockTeam: 6 }));
ok(wq.includes('above-replacement') && (wq.includes('wait') || wq.includes('thin') || wq.includes("Don't")), 'QB timing advice: ' + wq.slice(-80));

// commissioner context: recommendation targets on-clock team
const cc = mkCtx({ draftActive: true, onClockTeam: 2, userTeam: 4, pickIndex: 14, rosterOf: ti => ti === 2 ? [players[0]] : [] });
const whoC = G.askAssistant('who should I pick', cc).html;
ok(whoC.includes('Team 3'), 'commish: answer addresses team on the clock');

// help + fallback
ok(ask('help').includes('playoff'), 'help lists capabilities');
ok(ask('zzz qqq').includes("didn't catch"), 'graceful fallback');

// findPlayers robustness
ok(G.findPlayers('is amon-ra st. brown good', players)[0].name === 'Amon-Ra St. Brown', 'punctuated name match');
ok(G.findPlayers('thoughts on cmc christian mccaffrey', players)[0].name === 'Christian McCaffrey', 'full name match');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
