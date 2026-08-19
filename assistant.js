// ===== Draft Assistant (pure logic — no DOM). =====
// askAssistant(question, ctx) → { html } where ctx supplies live draft state:
//   players, values, rankMap, settings, weights,
//   available()          → undrafted players
//   rosterOf(teamIdx)    → players drafted by team
//   onClockTeam          → team index on the clock (or null pre-draft)
//   userTeam             → user's team index
//   pickIndex            → current overall pick index (or null)
//   draftActive          → bool
// Depends on: PLAYOFF_SOS, PLAYOFF_WEEKS, replacementRanks, WEIGHT_PCT.

const POS_WORDS = {
  qb: 'QB', quarterback: 'QB', rb: 'RB', 'running back': 'RB', wr: 'WR', receiver: 'WR', 'wide receiver': 'WR',
  te: 'TE', 'tight end': 'TE', k: 'K', kicker: 'K', dst: 'DST', def: 'DST', defense: 'DST', 'd/st': 'DST',
};

function aNorm(s) { return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim(); }

function findPlayers(q, players, max) {
  const nq = ' ' + aNorm(q) + ' ';
  const hits = [];
  for (const p of players) {
    const full = aNorm(p.name);
    if (nq.includes(' ' + full + ' ')) { hits.push({ p, len: full.length + 100 }); continue; }
    const parts = full.split(' ');
    const last = parts[parts.length - 1];
    if (last.length >= 4 && nq.includes(' ' + last + ' ')) hits.push({ p, len: last.length });
    else if (parts[0].length >= 4 && nq.includes(' ' + parts[0] + ' ') && parts[0] !== 'san') hits.push({ p, len: parts[0].length - 1 });
  }
  hits.sort((a, b) => b.len - a.len || (a.p.adp - b.p.adp));
  const out = [], seen = new Set();
  for (const h of hits) { if (!seen.has(h.p.id)) { seen.add(h.p.id); out.push(h.p); } }
  return out.slice(0, max || 4);
}

function posInQuery(q) {
  const nq = aNorm(q);
  for (const [w, pos] of Object.entries(POS_WORDS)) {
    if (new RegExp('(^|\\W)' + w + 's?(\\W|$)').test(nq)) return pos;
  }
  return null;
}

function favWord(f) { return f >= 8 ? 'great' : f >= 3 ? 'good' : f > -3 ? 'neutral' : f > -8 ? 'tough' : 'brutal'; }
function favMark(f) { return f >= 3 ? '✅' : f > -3 ? '➖' : '❌'; }
function sosLine(team) {
  const s = PLAYOFF_SOS[team];
  if (!s) return null;
  return s.w.map((x, i) => `W${PLAYOFF_WEEKS[i]} ${x.opp} ${favMark(x.fav)}`).join(' · ') + ` — playoff SOS rank ${s.rank}/32`;
}

function pName(p) { return `<b>${p.name}</b> <span class="ptag">${p.pos}·${p.team}</span>`; }

function askAssistant(q, ctx) {
  const { players, values, rankMap, settings } = ctx;
  const nq = aNorm(q);
  const avail = ctx.available();
  const pos = posInQuery(q);
  const named = findPlayers(q, players, 4);

  const li = items => `<ul style="margin:4px 0 4px 16px;padding:0">${items.map(x => `<li style="margin:2px 0">${x}</li>`).join('')}</ul>`;

  // HELP
  if (/^(help|\?|what can|hi$|hello)/.test(nq)) {
    return { html: `I can answer things like:` + li([
      `“<i>Who should I take?</i>” — pick advice for the team on the clock`,
      `“<i>Best RB available</i>” / “<i>top TEs</i>”`,
      `“<i>When is Gibbs' bye?</i>” / “<i>bye conflicts on my roster</i>” / “<i>who has bye week 7?</i>”`,
      `“<i>How is Chase Brown's playoff schedule?</i>” / “<i>best playoff matchups for WRs</i>”`,
      `“<i>Jahmyr Gibbs or Bijan?</i>” — head-to-head compare`,
      `“<i>When should I draft a QB?</i>” — scarcity check`,
      `“<i>Tell me about Puka Nacua</i>”`]) };
  }

  // COMPARE: two names + or/vs
  if (named.length >= 2 && /\b(or|vs|versus|over)\b/.test(nq)) {
    const [a, b] = named;
    const va = values[a.id], vb = values[b.id];
    const sa = PLAYOFF_SOS[a.team], sb = PLAYOFF_SOS[b.team];
    const better = va.adjVor >= vb.adjVor ? a : b;
    const diff = Math.abs(va.adjVor - vb.adjVor);
    const rows = [a, b].map(p => {
      const v = values[p.id];
      const s = PLAYOFF_SOS[p.team];
      return `${pName(p)} — proj <b>${v.adj}</b>, VOR <b>${v.adjVor}</b>, ADP ${p.adp}, bye ${p.bye}${p.injury ? `, <span class="inj">${p.injury}</span>` : ''}, playoff SOS ${s ? s.rank + '/32' : '—'}`;
    });
    let verdict = `<b>${better.name}</b> by my numbers (${diff.toFixed(1)} VOR edge${diff < 5 ? ' — basically a coin flip, take your guy' : ''}).`;
    if (a.pos !== b.pos) verdict += ` They play different positions, so roster need should break the tie.`;
    if (sa && sb && Math.abs(sa.rank - sb.rank) >= 12) {
      const eas = sa.rank < sb.rank ? a : b;
      verdict += ` Playoff schedule clearly favors ${eas.name} (${PLAYOFF_SOS[eas.team].rank}/32).`;
    }
    return { html: li(rows) + verdict };
  }

  // WHO SHOULD I TAKE
  if (/(who|what).*(take|pick|draft)|best pick|recommend|whom/.test(nq) && !pos) {
    const ti = ctx.draftActive ? (ctx.onClockTeam != null ? ctx.onClockTeam : ctx.userTeam) : ctx.userTeam;
    const your = ti === ctx.userTeam ? 'your' : 'their';
    const roster = ctx.rosterOf(ti);
    const recs = recommend(avail, roster, settings, values, 3);
    if (!recs.length) return { html: `Nobody left to draft!` };
    const need = unfilledStarters(settings.roster, roster);
    const items = recs.map((p, i) => {
      const v = values[p.id];
      const posLeft = avail.filter(x => x.pos === p.pos && values[x.id].adjVor > 0).length;
      const nextAtPos = avail.filter(x => x.pos === p.pos && x.id !== p.id).sort((x, y) => values[y.id].adjVor - values[x.id].adjVor)[0];
      const cliff = nextAtPos ? (v.adjVor - values[nextAtPos.id].adjVor) : 99;
      const s = PLAYOFF_SOS[p.team];
      let why = [`VOR ${v.adjVor}`, `ADP ${p.adp}`];
      if (need.includes(p.pos)) why.push(`fills ${your} ${p.pos} slot`);
      if (cliff >= 15) why.push(`big drop to the next ${p.pos} (−${cliff.toFixed(0)} VOR)`);
      else if (posLeft <= settings.teams) why.push(`only ${posLeft} startable ${p.pos}s left`);
      if (s && s.rank <= 8) why.push(`sweet playoff schedule (${s.rank}/32)`);
      if (s && s.rank >= 27) why.push(`⚠ rough playoff schedule (${s.rank}/32)`);
      if (p.injury) why.push(`⚠ ${p.injury}`);
      const byeClash = roster.filter(x => x.bye === p.bye && x.pos !== 'K' && x.pos !== 'DST').length;
      if (byeClash >= 2) why.push(`⚠ shares bye ${p.bye} with ${byeClash} of ${your} players`);
      return `${i + 1}. ${pName(p)} — ${why.join(', ')}`;
    });
    const tn = ctx.teamName ? ctx.teamName(ti) : 'Team ' + (ti + 1);
    const head = ctx.draftActive && ti !== ctx.userTeam ? `For <b>${tn}</b> (on the clock):` : `My board says:`;
    return { html: head + li(items) };
  }

  // BEST AVAILABLE AT POSITION (incl. playoff-flavored)
  if (pos && /(best|top|available|left|remaining)/.test(nq) && !/playoff/.test(nq)) {
    const list = avail.filter(p => p.pos === pos).sort((a, b) => values[b.id].adjVor - values[a.id].adjVor).slice(0, 5);
    if (!list.length) return { html: `No ${pos}s left on the board.` };
    return { html: `Best ${pos}s available:` + li(list.map(p => {
      const v = values[p.id];
      return `${pName(p)} — proj ${v.adj}, VOR ${v.adjVor}, ADP ${p.adp}, bye ${p.bye}${p.injury ? `, <span class="inj">${p.injury}</span>` : ''}`;
    })) };
  }

  // PLAYOFF QUESTIONS
  if (/playoff|week 1[5-7]|championship/.test(nq)) {
    if (named.length) {
      const p = named[0];
      const s = PLAYOFF_SOS[p.team];
      if (!s) return { html: `I don't have playoff schedule data for ${p.team}.` };
      const wk = s.w.map((x, i) => `Week ${PLAYOFF_WEEKS[i]}: ${x.opp} — ${favWord(x.fav)} matchup ${favMark(x.fav)}`);
      const summary = s.rank <= 8 ? `That's one of the best playoff schedules in the league (${s.rank}/32) — a real tiebreaker in his favor.`
        : s.rank >= 25 ? `That's one of the toughest playoff runs (${s.rank}/32) — worth a small discount if you're choosing between similar players.`
        : `Middle-of-the-road playoff schedule (${s.rank}/32) — not a deciding factor.`;
      return { html: `${pName(p)} (${p.team}) in the fantasy playoffs:` + li(wk) + summary };
    }
    if (pos) {
      const list = avail.filter(p => p.pos === pos && values[p.id].adjVor > -5)
        .sort((a, b) => values[b.id].adjVor - values[a.id].adjVor).slice(0, 12)
        .sort((a, b) => (PLAYOFF_SOS[a.team] ? PLAYOFF_SOS[a.team].rank : 33) - (PLAYOFF_SOS[b.team] ? PLAYOFF_SOS[b.team].rank : 33))
        .slice(0, 5);
      return { html: `Startable ${pos}s still available with the friendliest week 15–17 schedules:` + li(list.map(p =>
        `${pName(p)} — ${sosLine(p.team)}`)) };
    }
    const ranked = Object.entries(PLAYOFF_SOS).sort((a, b) => a[1].rank - b[1].rank);
    return { html: `Friendliest fantasy-playoff schedules (weeks 15–17): <b>` +
      ranked.slice(0, 6).map(([t, s]) => `${t} (${s.rank})`).join(', ') +
      `</b>.<br>Toughest: <b>` + ranked.slice(-5).map(([t, s]) => `${t} (${s.rank})`).join(', ') +
      `</b>.<br><span class="ptag">Ask about a specific player ("How's Gibbs' playoff schedule?") or position ("best playoff WRs").</span>` };
  }

  // BYE QUESTIONS
  if (/\bbye/.test(nq)) {
    if (named.length && !/my|roster|conflict|overlap/.test(nq)) {
      const p = named[0];
      return { html: `${pName(p)} has his bye in <b>week ${p.bye}</b>.` };
    }
    const wkMatch = nq.match(/(?:week|wk)\s*(\d{1,2})/) || nq.match(/bye\s*(\d{1,2})/);
    if (wkMatch) {
      const wk = +wkMatch[1];
      const list = avail.filter(p => p.bye === wk).sort((a, b) => rankMap[a.id] - rankMap[b.id]).slice(0, 8);
      if (!list.length) return { html: `No available players have a week-${wk} bye.` };
      return { html: `Notable available players on bye in week ${wk}:` + li(list.map(p => pName(p))) };
    }
    // roster bye overlaps
    const roster = ctx.rosterOf(ctx.userTeam);
    if (!roster.length) return { html: `You haven't drafted anyone yet — once you have a roster I'll flag bye-week pileups. (You can also ask "who has bye week 10?")` };
    const byWk = {};
    for (const p of roster) (byWk[p.bye] = byWk[p.bye] || []).push(p);
    const lines = Object.entries(byWk).sort((a, b) => +a[0] - +b[0]).map(([wk, ps]) => {
      const flag = ps.filter(x => x.pos !== 'K' && x.pos !== 'DST').length >= 3 ? ' ⚠ pile-up' : '';
      return `Week ${wk}: ${ps.map(x => x.name).join(', ')}${flag}`;
    });
    return { html: `Your roster by bye week:` + li(lines) };
  }

  // WHEN SHOULD I DRAFT A POSITION / SHOULD I WAIT
  if (pos && /(when|wait|how long|should i)/.test(nq)) {
    const repl = replacementRanks(settings)[pos];
    const startable = avail.filter(p => p.pos === pos && values[p.id].vor > 0).length;
    const top = avail.filter(p => p.pos === pos).sort((a, b) => values[b.id].adjVor - values[a.id].adjVor).slice(0, 3);
    let gap = null;
    if (ctx.draftActive && ctx.pickIndex != null) {
      let n = ctx.pickIndex;
      const total = settings.teams * totalRounds(settings);
      for (let i = ctx.pickIndex + (ctx.onClockTeam === ctx.userTeam ? 1 : 0); i < total; i++) {
        if (pickTeam(i, settings.teams) === ctx.userTeam) { gap = i - ctx.pickIndex; break; }
      }
    }
    const goneByThen = gap != null ? avail.filter(p => p.pos === pos && p.adp <= ctx.pickIndex + gap + 1).length : null;
    const items = [
      `<b>${startable}</b> above-replacement ${pos}s left (replacement level ≈ ${pos}${repl} in your league).`,
      top.length ? `Best remaining: ${top.map(p => p.name).join(', ')}.` : '',
      gap != null ? `Your next pick is in <b>${gap}</b> selections — roughly ${goneByThen} of the remaining ${pos}s go by then at ADP.` : '',
    ].filter(Boolean);
    const verdict = startable > settings.teams * 1.5
      ? `You can afford to wait — the ${pos} pool is deep.`
      : startable > settings.teams * 0.6
        ? `It's getting thin — one more round of waiting is defensible, two is a gamble.`
        : `Don't wait. The startable ${pos}s are nearly gone.`;
    return { html: li(items) + verdict };
  }

  // PLAYER CARD (tell me about X / bare name)
  if (named.length) {
    const p = named[0];
    const v = values[p.id];
    const w = ctx.weights[p.id] || 0;
    const pk = ctx.pickedInfo ? ctx.pickedInfo(p.id) : null;
    const items = [
      `Overall #${rankMap[p.id]} on your board (${p.pos}${p.posRank}), ADP ${p.adp}`,
      `Projected <b>${v.adj}</b> pts in your scoring (VOR ${v.adjVor})${w ? ` — includes your ${w > 0 ? '+' : ''}${Math.round(w * WEIGHT_PCT * 100)}% lean` : ''}`,
      `Bye week ${p.bye}${p.injury ? ` · <span class="inj">status: ${p.injury}</span>` : ''}`,
      p.a25 ? ('2025 actuals: ' + [
        p.a25.payd ? `${p.a25.payd} pass yds, ${p.a25.patd} pass TD` : '',
        p.a25.ruyd ? `${p.a25.ruyd} rush yds, ${p.a25.rutd} rush TD` : '',
        p.a25.rec ? `${p.a25.rec} rec for ${p.a25.reyd} yds, ${p.a25.retd} TD` : '',
      ].filter(Boolean).join(' · '))
        : (p.pos !== 'K' && p.pos !== 'DST' ? 'No meaningful 2025 stats (rookie or missed season)' : ''),
      sosLine(p.team) || 'No playoff schedule data',
      pk ? `Drafted: pick ${pk.label}` : (ctx.draftActive ? 'Still on the board' : ''),
    ].filter(Boolean);
    return { html: `${pName(p)}:` + li(items) };
  }

  if (pos) { // bare position
    const list = avail.filter(p => p.pos === pos).sort((a, b) => values[b.id].adjVor - values[a.id].adjVor).slice(0, 5);
    return { html: `Top available ${pos}s:` + li(list.map(p => `${pName(p)} — VOR ${values[p.id].adjVor}, ADP ${p.adp}`)) };
  }

  return { html: `I didn't catch that. Try “who should I take?”, “best RBs left”, “Gibbs or Bijan?”, “bye conflicts”, or “best playoff WRs”. Type <b>help</b> for the full list.` };
}

if (typeof module !== 'undefined') module.exports = { askAssistant, findPlayers, posInQuery };
