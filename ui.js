// ===== UI layer (DOM). Depends on core.js + assistant.js + PLAYER_DATA + PLAYOFF_SOS. =====
'use strict';

/* ---------- state ---------- */
const state = {
  tab: 'board',             // 'board' | 'draft' | 'grid'
  settings: defaultSettings(),
  weights: {},              // playerId -> -5..+5
  values: null,             // id -> {proj, adj, vor, adjVor}
  rankMap: {},              // id -> my overall rank (adjVor desc)
  sort: { key: 'myrank', dir: 1 },
  availSort: { key: 'vor', dir: 1 },   // Best Available panel sort (Draft Room / Grid View)
  posFilter: 'ALL',
  search: '',
  hideDrafted: false,
  showSettings: false,
  draft: null,              // see startDraft()
  rosterView: null,         // team index being viewed
  lastSync: null,
  syncing: false,
  confirmReset: false,
  setupMode: 'manual',
  setupSpeed: 600,
  assistOpen: false,
  assistDraft: '',
  focusAssist: false,
  chat: [],
  layout: { mode: 'side', split: 52, stackPx: 420, gridPx: null, sideGridPx: null, recsCollapsed: false, showStats: false }, // panes + prefs
  focusAvail: false,
  teamNames: {},            // teamIdx -> custom name
  showTeamNames: false,
  showWriteIn: false,
  recapOpen: {},            // teamIdx -> lineup expanded in the draft recap
  queue: [],                // saved player ids, in the user's own order (local, never synced)
};
const players = PLAYER_DATA; // mutated in place by Sleeper sync (team/bye/injury)

/* ---------- live mode (served from server.js) ---------- */
const LIVE = location.protocol === 'http:' || location.protocol === 'https:';
const COMMISH_KEY = LIVE ? new URLSearchParams(location.search).get('key') : null;
const IS_VIEWER = LIVE && !COMMISH_KEY;
state.liveStatus = LIVE ? 'connecting…' : null;
state.viewerCount = null;

// actions a viewer may NOT perform (everything local — sort/filter/search/
// leans/layout/assistant — stays allowed)
const VIEWER_BLOCKED = new Set(['start', 'setupmode', 'pause', 'resume', 'undo', 'draft', 'pickforme',
  'reset', 'writein', 'writeinadd', 'writeindraft', 'teamnames', 'clearteams', 'preset', 'sync', 'import']);

function syncPayload() {
  const d = state.draft;
  return {
    settings: state.settings,
    teamNames: state.teamNames,
    custom: players.filter(p => p.isCustom),
    rosterPatch: players.map(p => [p.id, p.team, p.bye, p.injury || 0, p.adp, p.posRank]),
    statsPatch: players.filter(p => p._live).map(p => [p.id, p.stats]),
    draft: d ? { mode: d.mode, picks: d.picks } : null,
  };
}
let _lastPushed = '', _pushTimer = null;
function schedulePush() {
  if (!LIVE || IS_VIEWER) return;
  clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => {
    const json = JSON.stringify(syncPayload());
    if (json === _lastPushed) return;
    _lastPushed = json;
    fetch('/state?key=' + encodeURIComponent(COMMISH_KEY), { method: 'POST', body: json })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(j => {
        state.liveStatus = 'live';
        if (j.viewers !== state.viewerCount) { state.viewerCount = j.viewers; renderHeader(); }
      })
      .catch(() => { state.liveStatus = 'offline'; renderHeader(); });
  }, 150);
}
function applyRemote(s) {
  if (!s) { render(); return; }
  const base = defaultSettings();
  state.settings = { ...base, ...s.settings, scoring: { ...base.scoring, ...(s.settings || {}).scoring }, roster: { ...base.roster, ...(s.settings || {}).roster } };
  state.teamNames = s.teamNames || {};
  for (let i = players.length - 1; i >= 0; i--) if (players[i].isCustom) players.splice(i, 1);
  for (const cp of (s.custom || [])) players.push(cp);
  if (s.rosterPatch) {
    const byId = {};
    players.forEach(p => byId[p.id] = p);
    for (const [id, team, bye, inj, adp, posRank] of s.rosterPatch) {
      const p = byId[id];
      if (p) {
        p.team = team; p.bye = bye; p.injury = inj || null;
        if (adp) p.adp = adp;
        if (posRank) p.posRank = posRank;
      }
    }
    if (s.statsPatch) {
      for (const [id, stats] of s.statsPatch) { if (byId[id]) byId[id].stats = stats; }
    }
  }
  state.draft = s.draft ? { mode: s.draft.mode, picks: s.draft.picks, paused: false, timer: null } : null;
  if (state.draft && state.rosterView == null) state.rosterView = state.settings.userSlot - 1;
  recompute();
  render();
}
function startLive() {
  if (!LIVE) return;
  if (IS_VIEWER) {
    const es = new EventSource('/events');
    es.onmessage = e => {
      state.liveStatus = 'live';
      try { applyRemote(JSON.parse(e.data).state); } catch (err) { render(); }
    };
    es.onerror = () => { state.liveStatus = 'reconnecting…'; renderHeader(); };
  } else {
    // commissioner: adopt any state already on the server (survives a reload)
    fetch('/state').then(r => r.json()).then(j => {
      if (j.state) { applyRemote(j.state); _lastPushed = JSON.stringify(syncPayload()); }
      state.liveStatus = 'live';
      render();
    }).catch(() => { state.liveStatus = 'offline'; renderHeader(); });
  }
}

function recompute() {
  state.values = computeValues(players, state.settings, state.weights);
  const order = players.slice().sort((a, b) => state.values[b.id].adjVor - state.values[a.id].adjVor);
  state.rankMap = {};
  order.forEach((p, i) => state.rankMap[p.id] = i + 1);
}
recompute();

/* ---------- helpers ---------- */
const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function toast(msg, ms) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms || 2600);
}
function fmt1(x) { return (Math.round(x * 10) / 10).toFixed(1); }
function teamName(i) {
  if (state.teamNames[i]) return state.teamNames[i];
  if (IS_VIEWER) return 'Team ' + (i + 1); // "You" would mean the commissioner
  return i === state.settings.userSlot - 1 ? 'You' : 'Team ' + (i + 1);
}
function customTag(p) { return p.isCustom ? ' <span class="customtag" title="Write-in player">✎</span>' : ''; }
function queueBtn(p) {
  const saved = state.queue.includes(p.id);
  return `<button class="qbtn ${saved ? 'on' : ''}" data-action="qtoggle" data-id="${p.id}" title="${saved ? 'Remove from' : 'Save to'} your queue">${saved ? '★' : '☆'}</button>`;
}
function toggleQueue(id) {
  const i = state.queue.indexOf(id);
  if (i === -1) state.queue.push(id); else state.queue.splice(i, 1);
  render();
}
function injTag(p) {
  if (!p.injury) return '';
  const short = { 'Questionable': 'Q', 'Doubtful': 'D', 'Out': 'O', 'IR': 'IR', 'PUP': 'PUP', 'Sus': 'SUS', 'NA': 'NA' }[p.injury] || p.injury;
  return `<span class="inj" title="${esc(p.injury)}">${esc(short)}</span>`;
}
function weightPct(w) { return (w > 0 ? '+' : '') + Math.round(w * WEIGHT_PCT * 100) + '%'; }

/* ---------- draft accessors ---------- */
function draftedIds() { return state.draft ? new Set(state.draft.picks) : new Set(); }
function availablePlayers() {
  const gone = draftedIds();
  return players.filter(p => !gone.has(p.id));
}
function teamRoster(ti) {
  const d = state.draft; if (!d) return [];
  const out = [];
  d.picks.forEach((pid, i) => {
    if (pickTeam(i, state.settings.teams) === ti) out.push(players.find(p => p.id === pid));
  });
  return out;
}
function pickedInfo(pid) {
  const d = state.draft; if (!d) return null;
  const i = d.picks.indexOf(pid);
  if (i === -1) return null;
  return { label: pickLabel(i, state.settings.teams), team: pickTeam(i, state.settings.teams) };
}
function currentPickIndex() { return state.draft.picks.length; }
function draftDone() {
  const total = state.settings.teams * totalRounds(state.settings);
  return state.draft.picks.length >= total || availablePlayers().length === 0;
}
function isUserTurn() {
  const d = state.draft;
  if (IS_VIEWER) return false; // viewers never draft
  if (!d || draftDone()) return false;
  if (d.mode === 'commish') return true; // you make every pick
  return d.mode === 'manual' &&
    pickTeam(currentPickIndex(), state.settings.teams) === state.settings.userSlot - 1;
}
function onClockTeam() {
  return state.draft && !draftDone() ? pickTeam(currentPickIndex(), state.settings.teams) : null;
}

/* ---------- draft engine ---------- */
function startDraft(mode) {
  const need = state.settings.teams * totalRounds(state.settings);
  if (need > players.length) {
    toast(`This setup needs ${need} picks but the board has ${players.length} players — trim bench/teams in Settings.`, 4200);
    return;
  }
  state.draft = { mode, speed: state.setupSpeed, picks: [], timer: null, paused: false };
  state.rosterView = state.settings.userSlot - 1;
  if (state.tab !== 'grid') state.tab = 'draft';
  loop();
}
function stopTimer() { if (state.draft && state.draft.timer) { clearTimeout(state.draft.timer); state.draft.timer = null; } }
function loop() {
  const d = state.draft; if (!d) return;
  stopTimer();
  if (draftDone()) {
    d.paused = false;
    if (!d.recapInit) { d.recapInit = true; state.recapOpen = { [state.settings.userSlot - 1]: true }; } // open your lineup first
    render(); return;
  }
  if (d.mode === 'commish') { render(); return; } // no AI, no timers — you pick everything
  if (d.paused) { render(); return; }
  if (isUserTurn()) { render(); return; }
  render();
  d.timer = setTimeout(() => {
    aiPickNow();
    loop();
  }, d.mode === 'manual' ? Math.min(d.speed, 350) : d.speed);
}
function aiPickNow() {
  const d = state.draft;
  const pi = currentPickIndex();
  const ti = pickTeam(pi, state.settings.teams);
  const sel = aiSelect(availablePlayers(), teamRoster(ti), state.settings, state.values, pi);
  if (sel) d.picks.push(sel.id);
}
function userDraft(pid) {
  const d = state.draft;
  if (!d || !isUserTurn()) return;
  if (draftedIds().has(pid)) return;
  d.picks.push(pid);
  loop();
}
function undoPick() {
  const d = state.draft; if (!d || !d.picks.length) return;
  stopTimer();
  d.picks.pop();
  if (d.mode !== 'commish') d.paused = true;
  render();
}
function resumeDraft() {
  const d = state.draft; if (!d) return;
  d.paused = false;
  loop();
}

/* ---------- Sleeper sync ---------- */
const INJ_MAP = { 'Questionable': 'Questionable', 'Doubtful': 'Doubtful', 'Out': 'Out', 'IR': 'IR', 'PUP': 'PUP', 'Sus': 'Sus', 'COV': 'Out', 'NA': 'NA' };
function nrmName(n) {
  return n.toLowerCase().replace(/[.,'\-]/g, '').replace(/\s+(jr|sr|ii|iii|iv|v)$/, '').replace(/\s+/g, ' ').trim();
}
// Sleeper projected-stat key → our stat field (only applied when present)
const PROJ_MAP = {
  pass_yd: 'payd', pass_td: 'patd', pass_int: 'int',
  rush_att: 'ruatt', rush_yd: 'ruyd', rush_td: 'rutd',
  rec: 'rec', rec_yd: 'reyd', rec_td: 'retd', fum_lost: 'fum',
  fgm_0_19: 'fg019', fgm_20_29: 'fg2029', fgm_30_39: 'fg3039',
  fgm_40_49: 'fg4049', fgm_50p: 'fg50', fgm: 'fg', xpm: 'xp',
  sack: 'sacks', int: 'dint', fum_rec: 'fumrec', def_td: 'dtd',
};
const OFFENSE_KEYS = ['pass_yd', 'pass_td', 'pass_int', 'rush_att', 'rush_yd', 'rush_td', 'rec', 'rec_yd', 'rec_td', 'fum_lost'];
async function syncSleeper() {
  if (state.syncing) return;
  state.syncing = true; render();
  let matched = 0, moved = 0, inj = 0, projN = 0, adpN = 0;
  let ok1 = false, ok2 = false;
  // 1) rosters & injuries (official endpoint)
  try {
    const resp = await fetch('https://api.sleeper.app/v1/players/nfl');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const all = await resp.json();
    const idx = {};
    for (const k in all) {
      const sp = all[k];
      if (!sp.full_name || !sp.position) continue;
      idx[nrmName(sp.full_name) + '|' + sp.position] = sp;
    }
    for (const p of players) {
      if (p.pos === 'DST') continue;
      const sp = idx[nrmName(p.name) + '|' + p.pos];
      if (!sp) continue;
      matched++;
      p.sid = sp.player_id;
      if (sp.team && sp.team !== p.team) {
        p.team = sp.team;
        p.bye = TEAM_BYES[sp.team] || p.bye;
        moved++;
      }
      const tag = sp.injury_status ? (INJ_MAP[sp.injury_status] || sp.injury_status) : null;
      if (tag !== p.injury) { p.injury = tag; }
      if (tag) inj++;
    }
    ok1 = true;
  } catch (e) { /* fall through — try projections anyway */ }
  // 2) current projections + ADP (endpoint Sleeper's own app uses)
  try {
    const season = new Date().getFullYear();
    const url = `https://api.sleeper.com/projections/nfl/${season}?season_type=regular` +
      ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map(x => '&position[]=' + x).join('') + '&order_by=adp_half_ppr';
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const rows = await resp.json();
    const bySid = {}, byName = {};
    for (const r of rows) {
      if (!r || !r.stats) continue;
      bySid[r.player_id] = r;
      if (r.player && r.player.last_name) {
        byName[nrmName((r.player.first_name || '') + ' ' + r.player.last_name) + '|' + (r.player.position === 'DEF' ? 'DST' : r.player.position)] = r;
      }
    }
    const rec = state.settings.scoring.rec;
    const adpKey = rec >= 1 ? 'adp_ppr' : rec > 0 ? 'adp_half_ppr' : 'adp_std';
    for (const p of players) {
      const r = (p.sid && bySid[p.sid]) || (p.pos === 'DST' ? bySid[p.team] : byName[nrmName(p.name) + '|' + p.pos]);
      if (!r) continue;
      const s = r.stats;
      // ADP (999 = undrafted in Sleeper)
      const adp = s[adpKey] || s.adp_half_ppr || s.adp_ppr || s.adp_std;
      if (adp && adp > 0 && adp < 600) { p.adp = Math.round(adp * 10) / 10; adpN++; }
      // projected stat lines: overwrite only the fields Sleeper provides
      let touched = false;
      const keys = p.pos === 'K' ? ['fgm_0_19', 'fgm_20_29', 'fgm_30_39', 'fgm_40_49', 'fgm_50p', 'fgm', 'xpm']
        : p.pos === 'DST' ? ['sack', 'int', 'fum_rec', 'def_td']
        : OFFENSE_KEYS;
      for (const k of keys) {
        if (s[k] != null && PROJ_MAP[k]) { p.stats[PROJ_MAP[k]] = Math.round(s[k] * 10) / 10; touched = true; }
      }
      if (touched) { p._live = true; projN++; }
    }
    // refresh positional ranks to the new ADP order
    for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DST']) {
      players.filter(p => p.pos === pos).sort((a, b) => a.adp - b.adp).forEach((p, i) => p.posRank = i + 1);
    }
    ok2 = true;
  } catch (e) { /* reported below */ }
  if (ok1 || ok2) {
    state.lastSync = new Date().toLocaleTimeString();
    toast(`Sleeper sync: ${matched} matched · ${moved} team changes · ${inj} injury tags · ${projN} projections + ${adpN} ADP updated${ok2 ? '' : ' (projections feed unavailable)'}`, 5000);
  } else {
    toast('Sleeper sync failed (offline or blocked)', 4000);
  }
  state.syncing = false;
  recompute();
  render();
}

/* ---------- export / import ---------- */
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: type || 'application/json' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
function exportProfile() {
  download('draft-lab-profile.json', JSON.stringify({ v: 1, settings: state.settings, weights: state.weights, layout: state.layout, teamNames: state.teamNames, customPlayers: players.filter(p => p.isCustom), queue: state.queue }, null, 2));
  toast('Profile exported — import it next session to restore settings + leans');
}
function importProfile(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const j = JSON.parse(r.result);
      if (j.settings) state.settings = { ...defaultSettings(), ...j.settings, scoring: { ...defaultSettings().scoring, ...j.settings.scoring }, roster: { ...defaultSettings().roster, ...j.settings.roster } };
      if (j.weights) state.weights = j.weights;
      if (j.layout) state.layout = { ...state.layout, ...j.layout };
      if (j.teamNames) state.teamNames = j.teamNames;
      if (Array.isArray(j.queue)) state.queue = j.queue;
      if (Array.isArray(j.customPlayers)) {
        for (const cp of j.customPlayers) {
          if (!players.find(p => nrmName(p.name) === nrmName(cp.name))) {
            cp.id = Math.max(...players.map(p => p.id)) + 1;
            players.push(cp);
          }
        }
      }
      recompute(); render();
      toast('Profile imported');
    } catch (e) { toast('Import failed: not a valid profile file'); }
  };
  r.readAsText(file);
}
function exportDraftCSV() {
  const d = state.draft; if (!d) return;
  let csv = 'pick,round.slot,team,player,pos,nfl_team,proj_pts\n';
  d.picks.forEach((pid, i) => {
    const p = players.find(x => x.id === pid);
    csv += [i + 1, pickLabel(i, state.settings.teams), '"' + teamName(pickTeam(i, state.settings.teams)).replace(/"/g, '""') + '"', '"' + p.name + '"', p.pos, p.team, state.values[p.id].proj].join(',') + '\n';
  });
  download('draft-results.csv', csv, 'text/csv');
}

/* ---------- rendering ---------- */
let _lastRenderTab = null;
function captureScroll() {
  return {
    tab: state.tab,
    win: [window.scrollX, window.scrollY],
    els: [...document.querySelectorAll('.tablewrap, .gridwrap, .log')].map(el => [el.scrollLeft, el.scrollTop]),
  };
}
function restoreScroll(s) {
  if (!s || s.tab !== state.tab) return; // switching views starts fresh at the top
  const els = [...document.querySelectorAll('.tablewrap, .gridwrap, .log')];
  els.forEach((el, i) => { if (s.els[i]) { el.scrollLeft = s.els[i][0]; el.scrollTop = s.els[i][1]; } });
  window.scrollTo(s.win[0], s.win[1]);
}
// let the main player table + bottom-most draft panes use every pixel down
// to the window bottom
function fitPanes() {
  for (const el of document.querySelectorAll('.tablewrap, .gridwrap.fitbottom')) {
    const top = el.getBoundingClientRect().top; // viewport-relative — valid even when the page is scrolled
    const h = Math.max(110, window.innerHeight - top - 14) + 'px';
    el.style.maxHeight = h;
    if (el.classList.contains('fitbottom')) el.style.height = h;
  }
}
window.addEventListener('resize', fitPanes);

function render() {
  schedulePush(); // live mode: commissioner broadcasts state after every change
  const scrollSnap = _lastRenderTab === state.tab ? captureScroll() : null;
  _lastRenderTab = state.tab;
  // preserve half-typed assistant question across re-renders (auto drafts re-render per pick)
  const ai = $('#assistInput');
  if (ai) state.assistDraft = ai.value;
  renderHeader();
  const v = $('#view');
  if (state.tab === 'board') v.innerHTML = renderBoard();
  else if (state.tab === 'grid') v.innerHTML = renderGridView();
  else if (state.tab === 'queue') v.innerHTML = renderQueue();
  else v.innerHTML = renderDraftRoom();
  fitPanes();
  restoreScroll(scrollSnap);
  if (state.showSettings) v.insertAdjacentHTML('beforeend', renderSettings());
  if (state.showTeamNames) v.insertAdjacentHTML('beforeend', renderTeamNames());
  if (state.showWriteIn) v.insertAdjacentHTML('beforeend', renderWriteIn());
  if (state.assistOpen) {
    v.insertAdjacentHTML('beforeend', renderAssistant());
    const box = $('#chatlog');
    if (box) box.scrollTop = box.scrollHeight;
    if (state.focusAssist) {
      const inp = $('#assistInput');
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
      state.focusAssist = false;
    }
  }
  if (state.focusAvail) {
    const inp = $('#availSearch');
    if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    state.focusAvail = false;
  }
}

/* ----- assistant dock ----- */
function assistCtx() {
  return {
    players, values: state.values, rankMap: state.rankMap, settings: state.settings, weights: state.weights,
    available: availablePlayers,
    rosterOf: teamRoster,
    onClockTeam: onClockTeam(),
    userTeam: state.settings.userSlot - 1,
    pickIndex: state.draft ? currentPickIndex() : null,
    draftActive: !!state.draft,
    pickedInfo,
    teamName,
  };
}
function askQuestion(q) {
  q = (q || '').trim();
  if (!q) return;
  state.chat.push({ role: 'u', html: esc(q) });
  let ans;
  try { ans = askAssistant(q, assistCtx()); }
  catch (err) { ans = { html: 'Hmm, I tripped over that one (' + esc(err.message) + '). Try rephrasing?' }; }
  state.chat.push({ role: 'a', html: ans.html });
  state.assistDraft = '';
  state.focusAssist = true;
  render();
}
function renderAssistant() {
  const chips = ['Who should I take?', 'Best RBs left', 'Bye conflicts', 'Best playoff WRs', 'When should I draft a QB?', 'help'];
  const msgs = state.chat.length
    ? state.chat.map(m => `<div class="msg ${m.role}">${m.html}</div>`).join('')
    : `<div class="msg a">Ask me anything about your draft — picks, bye weeks, playoff schedules, player comparisons. Try a suggestion below, or type <b>help</b>.</div>`;
  return `<aside class="assist">
    <div class="ahead">🧠 Draft Assistant <button class="btn small" data-action="assist" style="margin-left:auto">✕</button></div>
    <div id="chatlog" class="chatlog">${msgs}</div>
    <div class="achips">${chips.map(c => `<button class="chip" data-action="askchip" data-q="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <div class="abar">
      <input id="assistInput" type="text" placeholder="e.g. Gibbs or Bijan?" value="${esc(state.assistDraft)}" autocomplete="off">
      <button class="btn primary" data-action="asksend">Ask</button>
    </div>
  </aside>`;
}

function renderHeader() {
  const qn = state.queue.length;
  $('#tabs').innerHTML = `
    <button class="${state.tab === 'board' ? 'on' : ''}" data-action="tab" data-tab="board">Player Board</button>
    <button class="${state.tab === 'draft' ? 'on' : ''}" data-action="tab" data-tab="draft">Draft Room</button>
    <button class="${state.tab === 'grid' ? 'on' : ''}" data-action="tab" data-tab="grid">Grid View</button>
    <button class="${state.tab === 'queue' ? 'on' : ''}" data-action="tab" data-tab="queue">★ Queue${qn ? ' (' + qn + ')' : ''}</button>`;
  const liveBadge = !LIVE ? '' : IS_VIEWER
    ? `<span class="livebadge">👁 VIEWER · ${esc(state.liveStatus || '')}</span>`
    : `<span class="livebadge c">📡 COMMISSIONER · ${esc(state.liveStatus || '')}${state.viewerCount != null ? ' · ' + state.viewerCount + ' watching' : ''}</span>`;
  $('#hbtns').innerHTML = liveBadge + `
    <button class="btn ${state.assistOpen ? 'primary' : ''}" data-action="assist">🧠 Assistant</button>
    ${IS_VIEWER ? '' : `<button class="btn" data-action="sync" ${state.syncing ? 'disabled' : ''}>${state.syncing ? 'Syncing…' : (state.lastSync ? '↻ Synced ' + esc(state.lastSync) : '↻ Sync live (Sleeper)')}</button>`}
    <button class="btn" data-action="export">Export profile</button>
    ${IS_VIEWER ? '' : `<button class="btn" data-action="import">Import</button>`}
    <button class="btn ${IS_VIEWER ? '' : 'primary'}" data-action="settings">⚙ ${IS_VIEWER ? 'View settings' : 'League settings'}</button>`;
}

// shared comparator for board + best-available sorting
function boardCmp(key) {
  const vals = state.values;
  const S = {
    pPay: p => p.stats.payd || 0, pRuy: p => p.stats.ruyd || 0, pRey: p => p.stats.reyd || 0,
    pRec: p => p.stats.rec || 0, pTd: p => (p.stats.patd || 0) + (p.stats.rutd || 0) + (p.stats.retd || 0),
    aPay: p => p.a25 ? (p.a25.payd || 0) : -1, aRuy: p => p.a25 ? (p.a25.ruyd || 0) : -1,
    aRey: p => p.a25 ? (p.a25.reyd || 0) : -1, aRec: p => p.a25 ? (p.a25.rec || 0) : -1,
    aTd: p => p.a25 ? (p.a25.patd || 0) + (p.a25.rutd || 0) + (p.a25.retd || 0) : -1,
  };
  return {
    myrank: (a, b) => state.rankMap[a.id] - state.rankMap[b.id],
    name: (a, b) => a.name.localeCompare(b.name),
    pos: (a, b) => a.pos.localeCompare(b.pos) || state.rankMap[a.id] - state.rankMap[b.id],
    adp: (a, b) => a.adp - b.adp,
    proj: (a, b) => vals[b.id].adj - vals[a.id].adj,
    vor: (a, b) => vals[b.id].adjVor - vals[a.id].adjVor,
    ...Object.fromEntries(Object.entries(S).map(([k, f]) => [k, (a, b) => f(b) - f(a)])),
  }[key] || ((a, b) => 0);
}

function sortedBoard() {
  const { key, dir } = state.sort;
  let list = players.slice();
  if (state.posFilter !== 'ALL') {
    if (state.posFilter === 'FLEX') list = list.filter(p => p.pos === 'RB' || p.pos === 'WR' || p.pos === 'TE');
    else list = list.filter(p => p.pos === state.posFilter);
  }
  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter(p => p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q));
  }
  if (state.hideDrafted && state.draft) {
    const gone = draftedIds();
    list = list.filter(p => !gone.has(p.id));
  }
  const cmp = boardCmp(key);
  list.sort((a, b) => dir * cmp(a, b));
  return list;
}
const STAT_COLS = [
  ['pPay', 'Pass Yd', p => p.stats.payd, 0], ['pRuy', 'Rush Yd', p => p.stats.ruyd, 0],
  ['pRey', 'Rec Yd', p => p.stats.reyd, 0], ['pRec', 'Rec', p => p.stats.rec, 1],
  ['pTd', 'TD', p => (p.stats.patd || 0) + (p.stats.rutd || 0) + (p.stats.retd || 0), 1],
  ['aPay', 'Pass Yd', p => p.a25 && p.a25.payd, 0], ['aRuy', 'Rush Yd', p => p.a25 && p.a25.ruyd, 0],
  ['aRey', 'Rec Yd', p => p.a25 && p.a25.reyd, 0], ['aRec', 'Rec', p => p.a25 && p.a25.rec, 0],
  ['aTd', 'TD', p => p.a25 ? (p.a25.patd || 0) + (p.a25.rutd || 0) + (p.a25.retd || 0) : null, 0],
];
function statCell(p, f, dec) {
  const v = f(p);
  if (v == null || v === false || (v === 0 && !dec)) return '<td class="mono muted statcol">—</td>';
  return `<td class="mono statcol">${dec ? (Math.round(v * 10) / 10) : Math.round(v)}</td>`;
}

function renderBoard() {
  const presetName = { standard: 'Standard', half: 'Half PPR', ppr: 'Full PPR' }[state.settings.preset] || 'Custom';
  const list = sortedBoard();
  const gone = draftedIds();
  const arrow = k => state.sort.key === k ? `<span class="arr">${state.sort.dir === 1 ? '▲' : '▼'}</span>` : '';
  const showStats = state.layout.showStats;
  const rows = list.map(p => {
    const v = state.values[p.id];
    const w = state.weights[p.id] || 0;
    const pk = pickedInfo(p.id);
    return `<tr class="${gone.has(p.id) ? 'gone' : ''}" data-id="${p.id}">
      <td class="mono muted">${state.rankMap[p.id]}</td>
      <td><span class="pname">${esc(p.name)}</span>${customTag(p)}${injTag(p)}<div class="ptag">${p.team} · Bye ${p.bye}</div></td>
      <td><span class="pos ${p.pos}">${p.pos}</span> <span class="ptag mono">${p.pos}${p.posRank}</span></td>
      <td class="mono">${p.adp}</td>
      <td class="mono" title="Base: ${fmt1(v.proj)}">${fmt1(v.adj)}</td>
      <td class="mono ${v.adjVor >= 0 ? 'vorpos' : 'vorneg'}">${fmt1(v.adjVor)}</td>
      ${showStats ? STAT_COLS.map(([k, lbl, f, dec]) => statCell(p, f, dec)).join('') : ''}
      <td>${queueBtn(p)}</td>
      <td><span class="wctl">
        <button class="wbtn" data-action="w-" data-id="${p.id}" title="More bearish">−</button>
        <span class="wval ${w > 0 ? 'up' : w < 0 ? 'down' : 'zero'}" data-action="w0" data-id="${p.id}" title="${weightPct(w)} to projection — click to reset">${w > 0 ? '+' + w : w}</span>
        <button class="wbtn" data-action="w+" data-id="${p.id}" title="More bullish">+</button>
      </span></td>
      ${state.draft ? `<td class="ptag">${pk ? esc(pk.label) + ' · ' + esc(teamName(pk.team)) : '—'}</td>` : ''}
    </tr>`;
  }).join('');
  return `
  <div class="toolbar">
    <div class="chips">${['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST'].map(f =>
      `<button class="chip ${state.posFilter === f ? 'on' : ''}" data-action="filter" data-f="${f}">${f}</button>`).join('')}
    </div>
    <input id="searchBox" type="search" placeholder="Search player / team…" value="${esc(state.search)}" style="width:210px">
    <button class="chip ${showStats ? 'on' : ''}" data-action="togglestats" title="Show projected + 2025 actual stat columns">📊 Stats</button>
    <button class="chip" data-action="writein" title="Add a player who isn't on the board">➕ Write-in</button>
    ${state.draft ? `<label style="display:flex;gap:6px;align-items:center;font-size:12.5px" class="muted"><input type="checkbox" id="hideDrafted" ${state.hideDrafted ? 'checked' : ''}> hide drafted</label>` : ''}
    <span class="muted" style="margin-left:auto">${presetName} · ${state.settings.teams} teams · ${list.length} shown</span>
  </div>
  <div class="tablewrap">
    <table>
      <thead>
      ${showStats ? `<tr class="grouprow">
        <th class="nosort" colspan="6"></th>
        <th class="nosort group proj" colspan="5">2026 Projected</th>
        <th class="nosort group act" colspan="5">2025 Actual</th>
        <th class="nosort" colspan="${state.draft ? 3 : 2}"></th>
      </tr>` : ''}
      <tr class="${showStats ? 'sub' : ''}">
        <th data-action="sort" data-k="myrank" title="Your rank (weights applied)">#${arrow('myrank')}</th>
        <th data-action="sort" data-k="name">Player${arrow('name')}</th>
        <th data-action="sort" data-k="pos">Pos${arrow('pos')}</th>
        <th data-action="sort" data-k="adp" title="Average draft position (consensus)">ADP${arrow('adp')}</th>
        <th data-action="sort" data-k="proj" title="Projected season points under your scoring, with your weight applied">Proj${arrow('proj')}</th>
        <th data-action="sort" data-k="vor" title="Value over replacement at the position for your league size">VOR${arrow('vor')}</th>
        ${showStats ? STAT_COLS.map(([k, lbl]) => `<th class="statcol" data-action="sort" data-k="${k}">${lbl}${arrow(k)}</th>`).join('') : ''}
        <th class="nosort" title="Save to your personal queue">★</th>
        <th class="nosort" title="Bullish / bearish: each step moves the projection ±3%">Your lean</th>
        ${state.draft ? '<th class="nosort">Drafted</th>' : ''}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <p class="footnote">Projections: consensus rank order (SI top-200, Aug 2026) with stat lines anchored to FantasyPros multi-site averages (ESPN · CBS · NFL.com · Yahoo …), recomputed live for your scoring. 2025 actuals from Pro-Football-Reference season totals (“—” = rookie or missed season). “Sync live” pulls current teams, injury tags, projections &amp; ADP from the Sleeper API. Proj/VOR include your lean; ADP and the AI drafters ignore it (that's your edge). Use <b>Export profile</b> to save your settings &amp; leans to a file.</p>`;
}

/* ----- draft room building blocks ----- */
function draftPieces() {
  const d = state.draft;
  const T = state.settings.teams;
  const total = T * totalRounds(state.settings);
  const done = draftDone();
  const pi = currentPickIndex();
  const ti = done ? -1 : pickTeam(pi, T);
  const userTurn = isUserTurn();
  const avail = availablePlayers();

  let statusHtml;
  if (done) statusHtml = `<span class="onclock">🏁 Draft complete</span>`;
  else statusHtml = `<span class="pickchip mono">Pick ${pi + 1}/${total} · ${pickLabel(pi, T)}</span>
    <span class="onclock ${ti === state.settings.userSlot - 1 ? 'you' : ''}">${esc(teamName(ti))} on the clock${
      IS_VIEWER ? '' : d.mode === 'commish' ? ' — <span class="muted" style="font-weight:400">you pick for everyone</span>' : (userTurn ? ' — your pick!' : '')}</span>`;

  const L = state.layout;
  const layoutChips = `<span class="chips" title="Layout">
    <button class="chip ${state.tab === 'draft' && L.mode === 'side' ? 'on' : ''}" data-action="layout" data-m="side" title="Side by side (drag the divider to resize)">◫ Side</button>
    <button class="chip ${state.tab === 'draft' && L.mode === 'stack' ? 'on' : ''}" data-action="layout" data-m="stack" title="Stacked: grid on top, players below">⬒ Stacked</button>
    <button class="chip ${state.tab === 'grid' ? 'on' : ''}" data-action="tab" data-tab="grid" title="Maximized draft grid page">⛶ Grid view</button>
  </span>`;

  const controls = `
    ${!done && d.mode === 'auto' ? (d.paused
      ? `<button class="btn primary" data-action="resume">▶ Resume</button>`
      : `<button class="btn" data-action="pause">⏸ Pause</button>`) : ''}
    ${!done && d.mode === 'manual' && d.paused ? `<button class="btn primary" data-action="resume">▶ Resume</button>` : ''}
    ${userTurn ? `<button class="btn primary" data-action="pickforme">⚡ Pick for me</button>` : ''}
    <button class="btn" data-action="undo" ${d.picks.length ? '' : 'disabled'}>↩ Undo</button>
    <button class="btn" data-action="exportcsv" ${d.picks.length ? '' : 'disabled'}>⬇ CSV</button>
    <button class="btn danger" data-action="reset">${state.confirmReset ? 'Confirm reset?' : '✕ Reset draft'}</button>`;

  const bar = IS_VIEWER
    ? `<div class="draftbar">${statusHtml}<span style="margin-left:auto"></span>${layoutChips}
       <button class="btn" data-action="exportcsv" ${d.picks.length ? '' : 'disabled'}>⬇ CSV</button></div>`
    : `<div class="draftbar">${statusHtml}<span style="margin-left:auto"></span>${layoutChips}
    <button class="btn" data-action="writein" title="Add a player who isn't on the board">➕ Write-in</button>
    <button class="btn" data-action="teamnames" title="Rename the teams">✎ Teams</button>${controls}</div>`;

  // recommendations for whoever is on the clock (you, or the team you're running)
  let recsHtml = '';
  if (userTurn) {
    const recTeam = d.mode === 'commish' ? ti : state.settings.userSlot - 1;
    const recs = recommend(avail, teamRoster(recTeam), state.settings, state.values, 5);
    const recLabel = d.mode === 'commish' && recTeam !== state.settings.userSlot - 1
      ? `RECOMMENDED FOR ${esc(teamName(recTeam)).toUpperCase()} (your ranks + their needs)`
      : 'RECOMMENDED FOR YOU (your ranks + roster needs)';
    const collapsed = state.layout.recsCollapsed;
    const body = collapsed ? '' : recs.map(p => {
      const v = state.values[p.id];
      return `<div class="recrow">
        <button class="btn small primary" data-action="draft" data-id="${p.id}">Draft</button>
        <span class="pos ${p.pos}">${p.pos}</span>
        <b>${esc(p.name)}</b>${injTag(p)} <span class="ptag">${p.team}</span>
        <span class="why mono">Proj ${fmt1(v.adj)} · VOR ${fmt1(v.adjVor)} · ADP ${p.adp}</span>
      </div>`;
    }).join('');
    recsHtml = `<div class="recs${collapsed ? ' collapsed' : ''}">
      <div class="recshead" data-action="togglerecs" title="${collapsed ? 'Expand' : 'Collapse'} recommendations">
        <b style="font-size:12px;letter-spacing:.5px;color:var(--accent2)">${recLabel}</b>
        ${collapsed ? `<span class="ptag" style="margin-left:8px">${recs.length ? 'top: ' + esc(recs[0].name) : ''}</span>` : ''}
        <span class="rectoggle">${collapsed ? '▸' : '▾'}</span>
      </div>${body}</div>`;
  }

  // available list (respecting pos filter), sorted by user's adjusted VOR
  function availPanel(rowCount, maxH, fitBottom) {
    let alist = avail;
    if (state.posFilter !== 'ALL') {
      if (state.posFilter === 'FLEX') alist = alist.filter(p => ['RB', 'WR', 'TE'].includes(p.pos));
      else alist = alist.filter(p => p.pos === state.posFilter);
    }
    if (state.search) {
      const q = state.search.toLowerCase();
      alist = alist.filter(p => p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q));
    }
    const as = state.availSort;
    const acmp = boardCmp(as.key);
    alist = alist.slice().sort((a, b) => as.dir * acmp(a, b)).slice(0, rowCount);
    const showStats = state.layout.showStats;
    const aArrow = k => as.key === k ? `<span class="arr">${as.dir === 1 ? '▲' : '▼'}</span>` : '';
    const ath = (k, label, title) => `<th data-action="asort" data-k="${k}" ${title ? `title="${title}"` : ''}>${label}${aArrow(k)}</th>`;
    const rows = alist.map(p => {
      const v = state.values[p.id];
      return `<tr>
        <td class="mono muted">${state.rankMap[p.id]}</td>
        <td><span class="pname">${esc(p.name)}</span>${customTag(p)}${injTag(p)} <span class="ptag">${p.team} · Bye ${p.bye}</span></td>
        <td><span class="pos ${p.pos}">${p.pos}</span></td>
        <td class="mono">${p.adp}</td>
        <td class="mono">${fmt1(v.adj)}</td>
        <td class="mono ${v.adjVor >= 0 ? 'vorpos' : 'vorneg'}">${fmt1(v.adjVor)}</td>
        ${showStats ? STAT_COLS.map(([k, lbl, f, dec]) => statCell(p, f, dec)).join('') : ''}
        <td>${queueBtn(p)}${userTurn ? ` <button class="btn small primary" data-action="draft" data-id="${p.id}">Draft</button>` : ''}</td>
      </tr>`;
    }).join('');
    return `<div class="panel">
      <div class="phead">Best available <span class="muted" style="font-weight:400">· your adjusted VOR</span>
        <input id="availSearch" type="search" placeholder="Search…" value="${esc(state.search)}" style="width:150px;margin-left:auto;font-size:12.5px;padding:3px 8px">
        <button class="chip ${showStats ? 'on' : ''}" data-action="togglestats" title="Show projected + 2025 actual stat columns">📊 Stats</button>
        <span class="chips">${['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST'].map(f =>
          `<button class="chip ${state.posFilter === f ? 'on' : ''}" data-action="filter" data-f="${f}">${f}</button>`).join('')}</span>
      </div>
      ${recsHtml}
      <div class="gridwrap ${fitBottom ? 'fitbottom' : ''}" style="${maxH ? `max-height:${maxH}` : ''}"><table class="avail-table">
        <thead>
        ${showStats ? `<tr class="grouprow">
          <th class="nosort" colspan="6"></th>
          <th class="nosort group proj" colspan="5">2026 Projected</th>
          <th class="nosort group act" colspan="5">2025 Actual</th>
          <th class="nosort"></th>
        </tr>` : ''}
        <tr class="${showStats ? 'sub' : ''}">${ath('myrank', '#', 'Your overall rank')}${ath('name', 'Player')}${ath('pos', 'Pos')}${ath('adp', 'ADP')}${ath('proj', 'Proj')}${ath('vor', 'VOR')}
          ${showStats ? STAT_COLS.map(([k, lbl]) => `<th class="statcol" data-action="asort" data-k="${k}">${lbl}${aArrow(k)}</th>`).join('') : ''}
          <th class="nosort"></th></tr></thead>
        <tbody>${rows}</tbody></table></div>
    </div>`;
  }

  // draft grid
  function gridTable(big) {
    const rounds = totalRounds(state.settings);
    let grid = `<table class="dgrid${big ? ' big' : ''}"><tr><th></th>`;
    for (let t = 0; t < T; t++) grid += `<th class="${t === state.settings.userSlot - 1 ? 'usercol' : ''}">${esc(teamName(t))}</th>`;
    grid += '</tr>';
    for (let r = 0; r < rounds; r++) {
      grid += `<tr><td class="rd">${r + 1}</td>`;
      for (let t = 0; t < T; t++) {
        const withinRound = r % 2 === 0 ? t : T - 1 - t;
        const pIdx = r * T + withinRound;
        const pid = d.picks[pIdx];
        const p = pid ? players.find(x => x.id === pid) : null;
        grid += `<td class="${t === state.settings.userSlot - 1 ? 'usercol' : ''}">` +
          (p ? `<span class="cellp ${p.pos}"><span class="nm">${esc(p.name)}</span><span class="ptag">${p.pos} · ${p.team}</span></span>`
             : (pIdx === pi && !done ? '<span class="muted">⏱ …</span>' : '')) + '</td>';
      }
      grid += '</tr>';
    }
    return grid + '</table>';
  }
  function gridPanel(opts) {
    opts = opts || {};
    const style = opts.height ? `height:${opts.height}px;max-height:none` : '';
    return `<div class="panel">
      <div class="phead">Draft board
        ${state.tab === 'draft' ? `<button class="btn small" data-action="tab" data-tab="grid" style="margin-left:auto" title="Open maximized grid page">⛶ Maximize</button>` : ''}
      </div>
      <div class="gridwrap ${!opts.height && opts.fit ? 'fitbottom' : ''}" id="${opts.id || 'gridWrap'}" style="${style}">${gridTable(!!opts.big)}</div>
    </div>`;
  }

  // roster viewer
  const rv = state.rosterView == null ? state.settings.userSlot - 1 : state.rosterView;
  const slots = assignSlots(state.settings.roster, teamRoster(rv));
  const rosterHtml = slots.length
    ? slots.map(s => `<div class="rrow"><span class="slot">${s.slot}</span><span class="pos ${s.p.pos}">${s.p.pos}</span> <b>${esc(s.p.name)}</b> <span class="ptag">${s.p.team} · Bye ${s.p.bye} · ${fmt1(state.values[s.p.id].proj)} pts</span></div>`).join('')
    : '<div class="muted" style="padding:6px 0">No picks yet.</div>';
  const rosterPanel = `<div class="panel">
    <div class="phead">Roster
      <select data-action="rosterview" style="margin-left:auto">${Array.from({ length: T }, (_, t) =>
        `<option value="${t}" ${t === rv ? 'selected' : ''}>${esc(teamName(t))}</option>`).join('')}</select>
    </div>
    <div class="rosterlist">${rosterHtml}</div>
  </div>`;

  const log = d.picks.slice(-14).map((pid, j) => {
    const i = d.picks.length - Math.min(14, d.picks.length) + j;
    const p = players.find(x => x.id === pid);
    return `<div><span class="mono muted">${pickLabel(i, T)}</span> <b>${esc(teamName(pickTeam(i, T)))}</b> → <span class="pos ${p.pos}">${p.pos}</span> ${esc(p.name)}</div>`;
  }).reverse().join('');
  const logPanel = `<div class="panel"><div class="phead">Pick log</div><div class="log">${log || '<span class="muted">—</span>'}</div></div>`;

  // recap when done: ranked totals, each row expandable to the starting lineup
  let recap = '';
  if (done) {
    const scores = [];
    for (let t = 0; t < T; t++) {
      const all = assignSlots(state.settings.roster, teamRoster(t));
      const starters = all.filter(s => s.slot !== 'BN');
      scores.push({ t, starters, bench: all.filter(s => s.slot === 'BN'), pts: starters.reduce((a, s) => a + state.values[s.p.id].proj, 0) });
    }
    scores.sort((a, b) => b.pts - a.pts);
    recap = `<div class="panel" style="margin-bottom:12px"><div class="phead">📊 Projected starter points (draft recap) <span class="muted" style="font-weight:400;font-size:12px">· click a team to see the lineup</span></div><div class="rosterlist">` +
      scores.map((s, i) => {
        const open = !!state.recapOpen[s.t];
        const you = s.t === state.settings.userSlot - 1;
        let row = `<div class="rrow recaprow" data-action="recapteam" data-t="${s.t}" title="${open ? 'Hide' : 'Show'} lineup">
          <span class="slot mono">#${i + 1}</span>
          <b style="${you ? 'color:var(--accent2)' : ''}">${esc(teamName(s.t))}</b>
          <span class="ptag mono" style="margin-left:auto">${fmt1(s.pts)} proj pts</span>
          <span class="rectoggle">${open ? '▾' : '▸'}</span>
        </div>`;
        if (open) {
          row += `<div class="recaplineup">` +
            s.starters.map(x => `<div class="rrow"><span class="slot">${x.slot}</span><span class="pos ${x.p.pos}">${x.p.pos}</span> <b>${esc(x.p.name)}</b>${customTag(x.p)} <span class="ptag">${x.p.team} · Bye ${x.p.bye}</span><span class="ptag mono" style="margin-left:auto">${fmt1(state.values[x.p.id].proj)}</span></div>`).join('') +
            (s.bench.length ? `<div class="rrow"><span class="slot">BN</span><span class="ptag">${s.bench.map(x => esc(x.p.name)).join(' · ')}</span></div>` : '') +
            `</div>`;
        }
        return row;
      }).join('') +
      `</div></div>`;
  }

  return { bar, recap, availPanel, gridPanel, rosterPanel, logPanel };
}

/* ----- draft room (side-by-side or stacked, both resizable) ----- */
function renderDraftRoom() {
  if (!state.draft) return renderSetup();
  const P = draftPieces();
  const L = state.layout;

  if (L.mode === 'stack') {
    return `${P.bar}${P.recap}
      ${P.gridPanel({ id: 'gridWrapStack', height: L.stackPx, big: true })}
      <div class="hsplit" data-target="gridWrapStack" data-key="stackPx" title="Drag to resize"></div>
      ${P.availPanel(50, '44vh')}
      <div class="tworow">${P.rosterPanel}${P.logPanel}</div>`;
  }
  // side-by-side with vertical splitter; both main panes run to the window
  // bottom (grid height draggable via the bar under it)
  return `${P.bar}${P.recap}
    <div class="draftcols resizable" id="splitCols" style="grid-template-columns:minmax(0,${L.split}fr) 6px minmax(0,${100 - L.split}fr)">
      ${P.availPanel(60, '', true)}
      <div class="vsplit" title="Drag to resize"></div>
      <div>
        ${P.gridPanel({ id: 'gridWrapSide', height: L.sideGridPx, fit: true })}
        <div class="hsplit" data-target="gridWrapSide" data-key="sideGridPx" title="Drag to resize — shrink to reveal rosters &amp; pick log"></div>
        <div style="margin-bottom:12px">${P.rosterPanel}</div>
        ${P.logPanel}
      </div>
    </div>`;
}

/* ----- personal queue tab ----- */
function renderQueue() {
  const gone = draftedIds();
  let ids = state.queue.filter(id => players.some(p => p.id === id));
  const total = ids.length;
  if (state.hideDrafted && state.draft) ids = ids.filter(id => !gone.has(id));
  const showStats = state.layout.showStats; // queue is always in YOUR order; stats are reference columns
  const rows = ids.map((id, i) => {
    const p = players.find(x => x.id === id);
    const v = state.values[p.id];
    const w = state.weights[p.id] || 0;
    const pk = pickedInfo(p.id);
    const drafted = gone.has(p.id);
    return `<tr class="${drafted ? 'gone' : ''}">
      <td class="mono muted">${i + 1}</td>
      <td><span class="pname">${esc(p.name)}</span>${customTag(p)}${injTag(p)}<div class="ptag">${p.team} · Bye ${p.bye}</div></td>
      <td><span class="pos ${p.pos}">${p.pos}</span> <span class="ptag mono">${p.pos}${p.posRank}</span></td>
      <td class="mono muted">${state.rankMap[p.id]}</td>
      <td class="mono">${p.adp}</td>
      <td class="mono">${fmt1(v.adj)}</td>
      <td class="mono ${v.adjVor >= 0 ? 'vorpos' : 'vorneg'}">${fmt1(v.adjVor)}</td>
      ${showStats ? STAT_COLS.map(([k, lbl, f, dec]) => statCell(p, f, dec)).join('') : ''}
      <td><span class="wctl">
        <button class="wbtn" data-action="w-" data-id="${p.id}" title="More bearish">−</button>
        <span class="wval ${w > 0 ? 'up' : w < 0 ? 'down' : 'zero'}" data-action="w0" data-id="${p.id}">${w > 0 ? '+' + w : w}</span>
        <button class="wbtn" data-action="w+" data-id="${p.id}" title="More bullish">+</button>
      </span></td>
      ${state.draft ? `<td class="ptag">${pk ? esc(pk.label) + ' · ' + esc(teamName(pk.team)) : '—'}</td>` : ''}
      <td><span class="wctl">
        <button class="wbtn" data-action="qup" data-id="${p.id}" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="wbtn" data-action="qdown" data-id="${p.id}" title="Move down" ${i === ids.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="wbtn" data-action="qtoggle" data-id="${p.id}" title="Remove from queue" style="color:var(--down)">✕</button>
      </span></td>
    </tr>`;
  }).join('');
  const draftedCount = state.queue.filter(id => gone.has(id)).length;
  return `
  <div class="toolbar">
    <b style="font-size:15px">★ My Queue</b>
    <span class="muted">${total} saved${state.draft && draftedCount ? ` · ${draftedCount} drafted` : ''} — private to this screen, in your order</span>
    <button class="chip ${showStats ? 'on' : ''}" data-action="togglestats" title="Show projected + 2025 actual stat columns">📊 Stats</button>
    ${state.draft ? `<label style="display:flex;gap:6px;align-items:center;font-size:12.5px" class="muted"><input type="checkbox" id="hideDrafted" ${state.hideDrafted ? 'checked' : ''}> hide drafted</label>` : ''}
    ${total ? `<button class="btn small" data-action="clearqueue" style="margin-left:auto">Clear queue</button>` : ''}
  </div>
  ${total === 0
    ? `<div class="setupcard" style="text-align:center"><h2>Nothing saved yet</h2>
       <p class="muted" style="margin:12px 0">Hit the ☆ next to any player on the <a href="#" data-action="tab" data-tab="board" style="color:var(--accent)">Player Board</a> or the Best Available list to build a private watch list for your draft.</p></div>`
    : `<div class="tablewrap">
    <table>
      <thead>
      ${showStats ? `<tr class="grouprow">
        <th class="nosort" colspan="7"></th>
        <th class="nosort group proj" colspan="5">2026 Projected</th>
        <th class="nosort group act" colspan="5">2025 Actual</th>
        <th class="nosort" colspan="${state.draft ? 3 : 2}"></th>
      </tr>` : ''}
      <tr class="${showStats ? 'sub' : ''}">
        <th class="nosort" title="Your queue order">#</th><th class="nosort">Player</th><th class="nosort">Pos</th>
        <th class="nosort" title="Your overall board rank">Rank</th><th class="nosort">ADP</th>
        <th class="nosort">Proj</th><th class="nosort">VOR</th>
        ${showStats ? STAT_COLS.map(([k, lbl]) => `<th class="nosort statcol">${lbl}</th>`).join('') : ''}
        <th class="nosort">Your lean</th>
        ${state.draft ? '<th class="nosort">Drafted</th>' : ''}
        <th class="nosort">Order / remove</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`}`;
}

/* ----- maximized grid page ----- */
function renderGridView() {
  if (!state.draft) {
    return `<div class="setupcard"><h2>⛶ Grid View</h2>
      <p class="muted" style="margin:10px 0">The maximized draft grid lives here once a draft is running. Start one below.</p></div>` + renderSetup();
  }
  if (!state.layout.gridPx) state.layout.gridPx = Math.max(280, Math.round(window.innerHeight * 0.42));
  const P = draftPieces();
  return `${P.bar}${P.recap}
    ${P.gridPanel({ id: 'gridWrapMax', height: state.layout.gridPx, big: true })}
    <div class="hsplit" data-target="gridWrapMax" data-key="gridPx" title="Drag to resize"></div>
    ${P.availPanel(60, '', true)}`;
}

function renderSetup() {
  const s = state.settings;
  if (IS_VIEWER) {
    return `<div class="setupcard" style="text-align:center">
      <h2>👁 Waiting for the commissioner</h2>
      <p class="muted" style="margin:12px 0">You're connected (${esc(state.liveStatus || '')}). The draft will appear here the moment the commissioner starts it.
      Meanwhile the <a href="#" data-action="tab" data-tab="board" style="color:var(--accent)">Player Board</a> is all yours — sort, filter, search, and set your own leans.</p>
    </div>`;
  }
  const need = s.teams * totalRounds(s);
  const over = need > players.length;
  return `<div class="setupcard">
    <h2>🎯 Set up your mock draft</h2>
    <p class="muted">Snake draft · ${s.teams} teams · ${totalRounds(s)} rounds (${need} picks) · you pick from slot <b>${s.userSlot}</b>.
       Change any of that in <a href="#" data-action="settings" style="color:var(--accent)">league settings</a>,
       or <a href="#" data-action="teamnames" style="color:var(--accent)">name the teams</a>.</p>
    <div class="mode">
      <div class="modeopt ${state.setupMode === 'manual' ? 'on' : ''}" data-action="setupmode" data-m="manual">
        <b>🧑‍💻 Manual — you draft</b><div>AI runs the other ${s.teams - 1} teams. When you're on the clock, draft anyone or take a recommendation.</div>
      </div>
      <div class="modeopt ${state.setupMode === 'commish' ? 'on' : ''}" data-action="setupmode" data-m="commish">
        <b>🎛 Commissioner — you run it all</b><div>You make every pick for every team. Perfect for entering your real league's draft as it happens.</div>
      </div>
      <div class="modeopt ${state.setupMode === 'auto' ? 'on' : ''}" data-action="setupmode" data-m="auto">
        <b>🤖 Full auto — watch</b><div>AI drafts all ${s.teams} teams so you can study how the board falls. Pause anytime.</div>
      </div>
    </div>
    ${state.setupMode !== 'commish' ? `<label class="muted" style="display:flex;align-items:center;gap:10px;margin:12px 0">AI pick speed
      <input type="range" id="speedRange" min="150" max="2000" step="50" value="${state.setupSpeed}" style="flex:1">
      <span class="mono">${(state.setupSpeed / 1000).toFixed(2)}s</span></label>` : ''}
    ${over ? `<p class="warn">⚠ This setup needs ${need} picks but the board only has ${players.length} players. Reduce bench spots or team count in settings.</p>` : ''}
    <button class="btn primary" style="width:100%;padding:10px;font-size:15px" data-action="start" ${over ? 'disabled' : ''}>Start draft</button>
  </div>`;
}

/* ----- write-in players ----- */
function makeCustomPlayer(name, pos, team) {
  // stat line = 90% of the weakest documented player at that position
  const pool = players.filter(p => p.pos === pos && !p.isCustom);
  const weakest = pool.reduce((a, b) => state.values[a.id].adj <= state.values[b.id].adj ? a : b);
  const stats = JSON.parse(JSON.stringify(weakest.stats));
  for (const k in stats) if (typeof stats[k] === 'number') stats[k] = Math.round(stats[k] * 0.9 * 10) / 10;
  return {
    id: Math.max(...players.map(p => p.id)) + 1,
    name, pos, team: team || 'FA',
    bye: TEAM_BYES[team] || 0,
    adp: Math.max(...players.map(p => p.adp)) + 1,
    posRank: pool.length + 1,
    stats, isCustom: true,
  };
}
function addWriteIn(draftNow) {
  const name = ($('#wiName') ? $('#wiName').value : '').trim();
  const pos = $('#wiPos').value;
  const team = $('#wiTeam').value;
  if (!name) { toast('Give the player a name first'); return; }
  const existing = players.find(p => nrmName(p.name) === nrmName(name));
  if (existing) {
    state.showWriteIn = false;
    if (draftNow && isUserTurn() && !draftedIds().has(existing.id)) {
      userDraft(existing.id);
      toast(`${existing.name} was already on the board — drafted him`);
    } else {
      toast(`${existing.name} is already on the board (#${state.rankMap[existing.id]})`);
      render();
    }
    return;
  }
  const p = makeCustomPlayer(name, pos, team);
  players.push(p);
  recompute();
  state.showWriteIn = false;
  if (draftNow && isUserTurn()) {
    userDraft(p.id);
    toast(`✎ ${p.name} written in and drafted`);
  } else {
    render();
    toast(`✎ ${p.name} added to the player pool (${p.pos}${p.posRank})`);
  }
}
function renderWriteIn() {
  const teams = Object.keys(TEAM_BYES).sort();
  const canDraft = isUserTurn();
  return `<div class="overlay" data-action="closewriteinoverlay">
  <div class="modal" style="width:440px">
    <h2>➕ Write in a player</h2>
    <p class="muted" style="font-size:12.5px">For deep sleepers not on the board. He'll get a modest late-round projection (90% of the weakest documented player at his position) — bump him with leans if you're higher on him.</p>
    <div class="grid" style="grid-template-columns:1fr;margin-top:12px">
      <label>Player name<input type="text" id="wiName" maxlength="30" placeholder="e.g. Jimmy Sleeper" autocomplete="off"></label>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:8px">
      <label>Position<select id="wiPos">${['RB', 'WR', 'TE', 'QB', 'K', 'DST'].map(p => `<option>${p}</option>`).join('')}</select></label>
      <label>NFL team<select id="wiTeam"><option value="FA">FA / unknown</option>${teams.map(t => `<option>${t}</option>`).join('')}</select></label>
    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
      ${canDraft ? `<button class="btn primary" data-action="writeindraft">Add &amp; draft now</button>` : ''}
      <button class="btn ${canDraft ? '' : 'primary'}" data-action="writeinadd">Add to pool</button>
      <button class="btn" data-action="closewritein">Cancel</button>
    </div>
  </div></div>`;
}

/* ----- team names modal ----- */
function renderTeamNames() {
  const T = state.settings.teams;
  return `<div class="overlay" data-action="closeteamsoverlay">
  <div class="modal" style="width:480px">
    <h2>✎ Team names</h2>
    <p class="muted" style="font-size:12.5px">Name the league's teams (great for commissioner mode — mirror your real league). Blank = default. Saved with your exported profile.</p>
    <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:12px">
      ${Array.from({ length: T }, (_, i) => `<label>Team ${i + 1}${i === state.settings.userSlot - 1 ? ' (you)' : ''}
        <input type="text" maxlength="24" placeholder="${i === state.settings.userSlot - 1 ? 'You' : 'Team ' + (i + 1)}" value="${esc(state.teamNames[i] || '')}" data-tn="${i}">
      </label>`).join('')}
    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn primary" data-action="closeteams">Done</button>
      <button class="btn" data-action="clearteams">Clear all</button>
    </div>
  </div></div>`;
}

/* ----- settings modal ----- */
function renderSettings() {
  const s = state.settings;
  const locked = IS_VIEWER || (!!state.draft && state.draft.picks.length > 0);
  const sc = s.scoring;
  const scFields = [['payd', 'Pass yd'], ['patd', 'Pass TD'], ['int', 'INT'], ['ruyd', 'Rush yd'], ['rutd', 'Rush TD'], ['rec', 'Reception'], ['reyd', 'Rec yd'], ['retd', 'Rec TD'], ['fum', 'Fumble'], ['sack', 'Sack taken']];
  const kFields = [['fg019', 'FG 0-19'], ['fg2029', 'FG 20-29'], ['fg3039', 'FG 30-39'], ['fg4049', 'FG 40-49'], ['fg50', 'FG 50+'], ['fgm019', 'FG miss 0-19'], ['fgm2029', 'FG miss 20-29'], ['xpPts', 'XP made']];
  const dFields = [['dstSack', 'Sack'], ['dstInt', 'INT'], ['dstFum', 'Fum rec'], ['dstTd', 'Def TD']];
  const scInput = ([k, label]) => `<label>${label}<input type="number" step="any" value="${sc[k]}" data-scoring="${k}" ${locked ? 'disabled' : ''}></label>`;
  const roFields = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST', 'BN'];
  const need = s.teams * totalRounds(s);
  return `<div class="overlay" data-action="closeoverlay">
  <div class="modal">
    <h2>League settings</h2>
    <p class="muted" style="font-size:12.5px">Everything below re-ranks the board instantly.</p>
    ${locked ? `<p class="lockmsg">${IS_VIEWER ? "👁 View-only — these are the commissioner's league settings." : '🔒 A draft is in progress — reset it to change settings.'}</p>` : ''}
    <h3>Scoring preset</h3>
    <div class="chips">
      ${Object.entries(SCORING_PRESETS).map(([k, p]) =>
        `<button class="chip ${s.preset === k ? 'on' : ''}" data-action="preset" data-p="${k}" ${locked ? 'disabled' : ''}>${p.name}</button>`).join('')}
      <span class="chip ${s.preset === 'custom' ? 'on' : ''}" style="cursor:default">Custom</span>
    </div>
    <h3>Points per stat — offense</h3>
    <div class="grid">${scFields.map(scInput).join('')}</div>
    <p class="muted" style="font-size:11.5px;margin-top:4px">“Sack taken” is charged per sack your QB absorbs (Yahoo-style). Set 0 to ignore.</p>
    <h3>Kicker</h3>
    <div class="grid">${kFields.map(scInput).join('')}</div>
    <p class="muted" style="font-size:11.5px;margin-top:4px">Each kicker's projected FG total is split into distance buckets from league-wide rates (a few extra long balls for big legs). Miss penalties are usually negative (e.g. −1); leave 0 to ignore.</p>
    <h3>Team defense (DST)</h3>
    <div class="grid">${dFields.map(scInput).join('')}</div>
    <p class="muted" style="font-size:11.5px;margin-top:4px">A small points-allowed baseline per team is baked into projections and added on top of these.</p>
    <h3>League shape</h3>
    <div class="grid">
      <label>Teams<select data-set="teams" ${locked ? 'disabled' : ''}>${[8, 9, 10, 11, 12, 13, 14].map(n => `<option ${n === s.teams ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Your draft slot<select data-set="userSlot" ${locked ? 'disabled' : ''}>${Array.from({ length: s.teams }, (_, i) => `<option ${i + 1 === s.userSlot ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
    </div>
    <h3>Starting roster</h3>
    <div class="grid">
      ${roFields.map(k => `<label>${k}<input type="number" min="0" max="${k === 'BN' ? 10 : 4}" value="${s.roster[k]}" data-roster="${k}" ${locked ? 'disabled' : ''}></label>`).join('')}
    </div>
    <p class="muted" style="margin-top:10px;font-size:12.5px">${totalRounds(s)} rounds → ${need} total picks (player pool: ${players.length}).</p>
    ${need > players.length ? `<p class="warn">⚠ More picks than players — shrink bench or teams before drafting.</p>` : ''}
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn primary" data-action="closesettings">Done</button>
      <button class="btn" data-action="resetweights">Clear all leans</button>
    </div>
  </div></div>`;
}

/* ---------- pane resizing (drag splitters) ---------- */
let dragging = null; // {type:'v'} | {type:'h', targetId, key}
document.addEventListener('mousedown', e => {
  const v = e.target.closest('.vsplit');
  const h = e.target.closest('.hsplit');
  if (!v && !h) return;
  e.preventDefault();
  dragging = v ? { type: 'v' } : { type: 'h', targetId: h.dataset.target, key: h.dataset.key };
  document.body.classList.add(dragging.type === 'v' ? 'dragv' : 'dragh');
});
document.addEventListener('mousemove', e => {
  if (!dragging) return;
  if (dragging.type === 'v') {
    const cont = document.getElementById('splitCols');
    if (!cont) return;
    const r = cont.getBoundingClientRect();
    let pct = ((e.clientX - r.left) / r.width) * 100;
    pct = Math.max(26, Math.min(74, pct));
    state.layout.split = Math.round(pct * 10) / 10;
    cont.style.gridTemplateColumns = `minmax(0,${state.layout.split}fr) 6px minmax(0,${100 - state.layout.split}fr)`;
  } else {
    const el = document.getElementById(dragging.targetId);
    if (!el) return;
    const r = el.getBoundingClientRect();
    let px = Math.round(e.clientY - r.top);
    px = Math.max(140, Math.min(window.innerHeight - 200, px));
    state.layout[dragging.key] = px;
    el.style.height = px + 'px';
    el.style.maxHeight = 'none';
    el.classList.remove('fitbottom'); // height is now user-chosen, not auto
    fitPanes(); // panes below follow the divider live, staying glued to the window bottom
  }
});
document.addEventListener('mouseup', () => {
  if (dragging) {
    dragging = null;
    document.body.classList.remove('dragv', 'dragh');
    fitPanes();
  }
});

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  if (IS_VIEWER && VIEWER_BLOCKED.has(a)) { toast('👁 View-only — the commissioner runs the draft'); return; }
  if (a === 'tab') { state.tab = el.dataset.tab; render(); }
  else if (a === 'settings') { e.preventDefault(); state.showSettings = true; render(); }
  else if (a === 'closesettings') { state.showSettings = false; render(); }
  else if (a === 'closeoverlay') { if (!e.target.closest('.modal')) { state.showSettings = false; render(); } }
  else if (a === 'preset') {
    const p = el.dataset.p;
    state.settings.preset = p;
    state.settings.scoring.rec = SCORING_PRESETS[p].rec;
    recompute(); render();
  }
  else if (a === 'filter') { state.posFilter = el.dataset.f; render(); }
  else if (a === 'layout') { state.layout.mode = el.dataset.m; if (state.tab === 'grid') state.tab = 'draft'; render(); }
  else if (a === 'togglerecs') { state.layout.recsCollapsed = !state.layout.recsCollapsed; render(); }
  else if (a === 'togglestats') { state.layout.showStats = !state.layout.showStats; render(); }
  else if (a === 'teamnames') { e.preventDefault(); state.showTeamNames = true; render(); }
  else if (a === 'closeteams') { state.showTeamNames = false; render(); }
  else if (a === 'closeteamsoverlay') { if (!e.target.closest('.modal')) { state.showTeamNames = false; render(); } }
  else if (a === 'clearteams') { state.teamNames = {}; render(); }
  else if (a === 'writein') { state.showWriteIn = true; render(); const n = $('#wiName'); if (n) n.focus(); }
  else if (a === 'closewritein') { state.showWriteIn = false; render(); }
  else if (a === 'closewriteinoverlay') { if (!e.target.closest('.modal')) { state.showWriteIn = false; render(); } }
  else if (a === 'writeinadd') addWriteIn(false);
  else if (a === 'writeindraft') addWriteIn(true);
  else if (a === 'recapteam') { const t = +el.dataset.t; state.recapOpen[t] = !state.recapOpen[t]; render(); }
  else if (a === 'qtoggle') toggleQueue(+el.dataset.id);
  else if (a === 'qup' || a === 'qdown') {
    const id = +el.dataset.id;
    const i = state.queue.indexOf(id);
    const j = a === 'qup' ? i - 1 : i + 1;
    if (i !== -1 && j >= 0 && j < state.queue.length) {
      [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
      render();
    }
  }
  else if (a === 'clearqueue') { state.queue = []; render(); toast('Queue cleared'); }
  else if (a === 'sort') {
    const k = el.dataset.k;
    if (state.sort.key === k) state.sort.dir *= -1;
    else state.sort = { key: k, dir: 1 };
    render();
  }
  else if (a === 'asort') {
    const k = el.dataset.k;
    if (state.availSort.key === k) state.availSort.dir *= -1;
    else state.availSort = { key: k, dir: 1 };
    render();
  }
  else if (a === 'w+' || a === 'w-' || a === 'w0') {
    const id = +el.dataset.id;
    let w = state.weights[id] || 0;
    if (a === 'w+') w = Math.min(5, w + 1);
    else if (a === 'w-') w = Math.max(-5, w - 1);
    else w = 0;
    if (w === 0) delete state.weights[id]; else state.weights[id] = w;
    recompute(); render();
  }
  else if (a === 'resetweights') { state.weights = {}; recompute(); render(); toast('All leans cleared'); }
  else if (a === 'assist') { state.assistOpen = !state.assistOpen; state.focusAssist = state.assistOpen; render(); }
  else if (a === 'askchip') askQuestion(el.dataset.q);
  else if (a === 'asksend') askQuestion($('#assistInput') ? $('#assistInput').value : '');
  else if (a === 'sync') syncSleeper();
  else if (a === 'export') exportProfile();
  else if (a === 'import') $('#importFile').click();
  else if (a === 'setupmode') { state.setupMode = el.dataset.m; render(); }
  else if (a === 'start') startDraft(state.setupMode);
  else if (a === 'pause') { state.draft.paused = true; stopTimer(); render(); }
  else if (a === 'resume') resumeDraft();
  else if (a === 'undo') undoPick();
  else if (a === 'draft') userDraft(+el.dataset.id);
  else if (a === 'pickforme') {
    const ti = state.draft && state.draft.mode === 'commish' ? onClockTeam() : state.settings.userSlot - 1;
    const recs = recommend(availablePlayers(), teamRoster(ti), state.settings, state.values, 1);
    if (recs[0]) userDraft(recs[0].id);
  }
  else if (a === 'exportcsv') exportDraftCSV();
  else if (a === 'reset') {
    if (!state.confirmReset) {
      state.confirmReset = true; render();
      setTimeout(() => { if (state.confirmReset) { state.confirmReset = false; render(); } }, 2500);
    } else {
      state.confirmReset = false; stopTimer(); state.draft = null; render();
    }
  }
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'searchBox') {
    state.search = el.value;
    // re-render only rows to keep focus
    const wrap = document.querySelector('.tablewrap tbody');
    if (wrap) {
      const html = renderBoard();
      const tmp = document.createElement('div'); tmp.innerHTML = html;
      wrap.innerHTML = tmp.querySelector('tbody').innerHTML;
      const cnt = document.querySelector('.toolbar .muted:last-child');
      const cnt2 = tmp.querySelector('.toolbar .muted:last-child');
      if (cnt && cnt2) cnt.textContent = cnt2.textContent;
    }
  }
  else if (el.id === 'availSearch') {
    state.search = el.value;
    state.focusAvail = true;
    render();
  }
  else if (el.id === 'speedRange') {
    state.setupSpeed = +el.value;
    el.nextElementSibling.textContent = (state.setupSpeed / 1000).toFixed(2) + 's';
    if (state.draft) state.draft.speed = state.setupSpeed;
  }
  else if (el.id === 'hideDrafted') { state.hideDrafted = el.checked; render(); }
});

document.addEventListener('change', e => {
  const el = e.target;
  if (IS_VIEWER && (el.dataset.tn != null || el.dataset.scoring || el.dataset.roster || el.dataset.set)) {
    toast('👁 View-only — league settings belong to the commissioner');
    render();
    return;
  }
  if (el.dataset.tn != null) {
    const i = +el.dataset.tn;
    const v = el.value.trim();
    if (v) state.teamNames[i] = v; else delete state.teamNames[i];
    return; // no re-render mid-typing; grid/rosters refresh when the modal closes
  }
  if (el.dataset.scoring) {
    state.settings.scoring[el.dataset.scoring] = parseFloat(el.value) || 0;
    const rec = state.settings.scoring.rec;
    state.settings.preset = rec === 0 ? 'standard' : rec === 0.5 ? 'half' : rec === 1 ? 'ppr' : 'custom';
    recompute(); render();
  }
  else if (el.dataset.roster) {
    state.settings.roster[el.dataset.roster] = Math.max(0, parseInt(el.value) || 0);
    recompute(); render();
  }
  else if (el.dataset.set === 'teams') {
    state.settings.teams = +el.value;
    state.settings.userSlot = Math.min(state.settings.userSlot, state.settings.teams);
    recompute(); render();
  }
  else if (el.dataset.set === 'userSlot') { state.settings.userSlot = +el.value; render(); }
  else if (el.dataset.action === 'rosterview') { state.rosterView = +el.value; render(); }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'assistInput') askQuestion(e.target.value);
});

$('#importFile').addEventListener('change', e => {
  if (e.target.files[0]) importProfile(e.target.files[0]);
  e.target.value = '';
});

render();
startLive();
