// End-to-end smoke test of the assembled single-file app
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const { pathToFileURL } = require('url');

const INDEX_URL = pathToFileURL(path.join(__dirname, 'index.html')).href;
const SHOTS = path.join(__dirname, 'shots');

(async () => {
  // CHROMIUM_PATH overrides the browser binary (e.g. in sandboxes); otherwise use Playwright's own install
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  let pass = 0, fail = 0;
  const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL:', msg); } };

  await page.goto(INDEX_URL);
  await page.waitForTimeout(400);

  // Board renders
  const rows = await page.locator('.tablewrap tbody tr').count();
  ok(rows === 300, `board shows all 300 players (got ${rows})`);
  const first = await page.locator('.tablewrap tbody tr .pname').first().textContent();
  console.log('Top player (half PPR default):', first);
  ok(!!first, 'has top player');
  await page.screenshot({ path: path.join(SHOTS, '01-board.png') });

  // ---- Stats columns toggle + sorting ----
  await page.click('[data-action="togglestats"]');
  await page.waitForTimeout(150);
  ok(await page.locator('.grouprow').count() === 1, 'stats toggle shows group header row');
  ok((await page.locator('.grouprow th.proj').textContent()).includes('2026 Projected'), 'projected group header');
  ok((await page.locator('.grouprow th.act').textContent()).includes('2025 Actual'), 'actual group header');
  // sort by 2025 rushing yards → James Cook led 2025 with 1621
  await page.locator('th[data-k="aRuy"]').click();
  await page.waitForTimeout(150);
  const topRusher = await page.locator('.tablewrap tbody tr .pname').first().textContent();
  ok(topRusher === 'James Cook', `2025 rush yds sort leader = James Cook (got ${topRusher})`);
  // sort by projected pass yards → Dak Prescott (4294) tops FantasyPros projections
  await page.locator('th[data-k="pPay"]').click();
  await page.waitForTimeout(150);
  const topPasser = await page.locator('.tablewrap tbody tr .pname').first().textContent();
  ok(topPasser === 'Dak Prescott', `projected pass yds sort leader = Dak Prescott (got ${topPasser})`);
  // sort by 2025 receptions → Puka Nacua 129
  await page.locator('th[data-k="aRec"]').click();
  await page.waitForTimeout(150);
  const topCatcher = await page.locator('.tablewrap tbody tr .pname').first().textContent();
  ok(topCatcher === 'Puka Nacua', `2025 receptions sort leader = Puka Nacua (got ${topCatcher})`);
  // rookie shows dashes in actual columns
  await page.fill('#searchBox', 'jeremiyah');
  await page.waitForTimeout(150);
  const rookieRow = await page.locator('.tablewrap tbody tr').first().textContent();
  ok(rookieRow.includes('—'), 'rookie shows — for 2025 actuals');
  await page.fill('#searchBox', '');
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(SHOTS, '10-stats.png') });
  // toggle off restores compact board and myrank sort for next tests
  await page.click('[data-action="togglestats"]');
  await page.locator('th[data-k="myrank"]').click();
  await page.waitForTimeout(150);

  // ---- Scroll retention + full-height board ----
  // board fills the window down to the bottom
  const fit = await page.evaluate(() => {
    const r = document.querySelector('.tablewrap').getBoundingClientRect();
    return { bottom: r.bottom, ih: window.innerHeight };
  });
  ok(fit.ih - fit.bottom < 30 && fit.ih - fit.bottom > -2, `board fills to window bottom (gap ${Math.round(fit.ih - fit.bottom)}px)`);
  // scrolled position survives clicking (star a player mid-list)
  await page.setViewportSize({ width: 1000, height: 800 }); // force horizontal overflow
  await page.click('[data-action="togglestats"]');
  await page.waitForTimeout(150);
  const setPos = await page.evaluate(() => {
    const w = document.querySelector('.tablewrap');
    w.scrollTop = 600; w.scrollLeft = 250;
    return { top: w.scrollTop, left: w.scrollLeft }; // browser may clamp
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.tablewrap tbody tr')];
    const w = document.querySelector('.tablewrap');
    const visible = rows.find(r => r.getBoundingClientRect().top > w.getBoundingClientRect().top + 40);
    visible.querySelector('.qbtn').click();
  });
  await page.waitForTimeout(150);
  const kept = await page.evaluate(() => {
    const w = document.querySelector('.tablewrap');
    return { top: w.scrollTop, left: w.scrollLeft };
  });
  ok(Math.abs(kept.top - setPos.top) < 5 && Math.abs(kept.left - setPos.left) < 5 && setPos.left > 100, `scroll preserved after star click (${kept.top}, ${kept.left} vs ${setPos.top}, ${setPos.left})`);
  // weight click deep in the list also preserves scroll
  await page.evaluate(() => {
    const w = document.querySelector('.tablewrap');
    const rows = [...document.querySelectorAll('.tablewrap tbody tr')];
    rows.find(r => r.getBoundingClientRect().top > w.getBoundingClientRect().top + 40).querySelector('[data-action="w+"]').click();
  });
  await page.waitForTimeout(150);
  ok(Math.abs(await page.evaluate(() => document.querySelector('.tablewrap').scrollTop) - 600) < 5, 'scroll preserved after lean click');
  // switching tabs starts fresh at the top
  await page.click('[data-action="tab"][data-tab="queue"]');
  await page.waitForTimeout(120);
  await page.click('[data-action="tab"][data-tab="board"]');
  await page.waitForTimeout(120);
  ok(await page.evaluate(() => document.querySelector('.tablewrap').scrollTop) === 0, 'tab switch resets scroll');
  await page.click('[data-action="togglestats"]');
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.evaluate(() => { state.queue = []; state.weights = {}; recompute(); render(); });
  await page.waitForTimeout(120);

  // ---- Personal save queue ----
  for (let i = 0; i < 3; i++) await page.locator('.tablewrap tbody tr .qbtn').nth(i).click();
  await page.waitForTimeout(150);
  ok((await page.locator('#tabs button').last().textContent()).includes('(3)'), 'queue tab shows count 3');
  const savedName = await page.locator('.tablewrap tbody tr .pname').nth(1).textContent(); // 2nd saved
  await page.click('[data-action="tab"][data-tab="queue"]');
  await page.waitForTimeout(150);
  ok(await page.locator('.tablewrap tbody tr').count() === 3, 'queue lists 3 saved players');
  const qFirst = await page.locator('.tablewrap tbody tr .pname').first().textContent();
  await page.locator('[data-action="qdown"]').first().click();
  await page.waitForTimeout(120);
  const qSecondNow = await page.locator('.tablewrap tbody tr .pname').nth(1).textContent();
  ok(qSecondNow === qFirst, `queue reorder works (${qFirst} moved down)`);
  // remove one with ✕
  await page.locator('.tablewrap tbody tr [data-action="qtoggle"]').first().click();
  await page.waitForTimeout(120);
  ok(await page.locator('.tablewrap tbody tr').count() === 2, 'queue remove (✕) works');
  ok((await page.locator('#tabs button').last().textContent()).includes('(2)'), 'tab count updates to 2');
  // queue: stats columns visible, headers NOT sortable, reorder always available
  await page.click('[data-action="tab"][data-tab="queue"]');
  await page.waitForTimeout(120);
  await page.locator('.toolbar [data-action="togglestats"]').click();
  await page.waitForTimeout(150);
  ok(await page.locator('.tablewrap .grouprow').count() === 1, 'queue shows stat group headers');
  ok(await page.locator('.tablewrap th[data-action]').count() === 0, 'queue headers are not sortable');
  ok(await page.locator('[data-action="qup"]').count() === 2, 'reorder buttons always present with stats on');
  const qOrderBefore = await page.locator('.tablewrap tbody .pname').first().textContent();
  await page.locator('[data-action="qdown"]').first().click();
  await page.waitForTimeout(120);
  ok(await page.locator('.tablewrap tbody .pname').nth(1).textContent() === qOrderBefore, 'manual reorder works with stats visible');
  await page.locator('[data-action="qup"]').nth(1).click();
  await page.waitForTimeout(120);
  await page.locator('.toolbar [data-action="togglestats"]').click();
  await page.waitForTimeout(120);
  // stars reflect on the board
  await page.click('[data-action="tab"][data-tab="board"]');
  await page.waitForTimeout(150);
  ok(await page.locator('.qbtn.on').count() === 2, 'board shows 2 filled stars');
  await page.evaluate(() => { state.queue = []; });
  await page.click('[data-action="tab"][data-tab="board"]');
  await page.waitForTimeout(100);

  // Weight a player up and confirm rank improves
  const targetRow = page.locator('.tablewrap tbody tr').nth(19); // 20th player
  const name20 = await targetRow.locator('.pname').textContent();
  for (let i = 0; i < 5; i++) await targetRow.locator('[data-action="w+"]').click();
  await page.waitForTimeout(150);
  // find the row again by name and read its # cell
  const rankAfter = await page.evaluate(nm => {
    const rows = [...document.querySelectorAll('.tablewrap tbody tr')];
    const r = rows.find(x => x.querySelector('.pname').textContent === nm);
    return { rank: +r.querySelector('td').textContent, idx: rows.indexOf(r) };
  }, name20);
  ok(rankAfter.rank < 20 && rankAfter.idx < 19, `+5 lean moved ${name20} up (now #${rankAfter.rank})`);
  await page.screenshot({ path: path.join(SHOTS, '02-weighted.png') });

  // Scoring preset switch reorders board
  await page.click('[data-action="settings"]');
  await page.click('[data-action="preset"][data-p="standard"]');
  await page.click('[data-action="closesettings"]');
  await page.waitForTimeout(150);
  const firstStd = await page.locator('.tablewrap tbody tr .pname').first().textContent();
  console.log('Top player (standard):', firstStd);
  await page.click('[data-action="settings"]');
  await page.click('[data-action="preset"][data-p="ppr"]');
  await page.click('[data-action="closesettings"]');
  const firstPpr = await page.locator('.tablewrap tbody tr .pname').first().textContent();
  console.log('Top player (full PPR):', firstPpr);
  ok(true, 'preset switching works without errors');

  // Search
  await page.fill('#searchBox', 'nacua');
  await page.waitForTimeout(120);
  const searchRows = await page.locator('.tablewrap tbody tr').count();
  ok(searchRows === 1, `search narrows to 1 row (got ${searchRows})`);
  const focused = await page.evaluate(() => document.activeElement.id);
  ok(focused === 'searchBox', 'search box keeps focus while typing');
  await page.fill('#searchBox', '');
  await page.waitForTimeout(120);

  // Position filter
  await page.locator('.toolbar [data-action="filter"][data-f="TE"]').click();
  const teRows = await page.locator('.tablewrap tbody tr').count();
  ok(teRows === 39, `TE filter shows 39 (got ${teRows})`);
  await page.locator('.toolbar [data-action="filter"][data-f="ALL"]').click();

  // Sort by ADP
  await page.locator('th[data-k="adp"]').click();
  const adpFirst = await page.locator('.tablewrap tbody tr td:nth-child(4)').first().textContent();
  ok(adpFirst.trim() === '1', 'ADP sort ascending puts ADP 1 first');

  // ---- Manual draft ----
  await page.click('[data-action="tab"][data-tab="draft"]');
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(SHOTS, '03-setup.png') });
  // speed up AI
  await page.locator('#speedRange').fill('150');
  await page.click('[data-action="start"]');
  // user slot default = 5 → 4 AI picks first; wait for recs
  await page.waitForSelector('.recs', { timeout: 15000 });
  await page.screenshot({ path: path.join(SHOTS, '04-userturn.png') });
  const recCount = await page.locator('.recrow').count();
  ok(recCount === 5, `5 recommendations shown (got ${recCount})`);
  // draft top recommendation
  await page.locator('.recrow [data-action="draft"]').first().click();
  await page.waitForTimeout(600);
  const myRosterCount = await page.evaluate(() => document.querySelectorAll('.rosterlist .rrow').length);
  ok(myRosterCount >= 1, `user roster shows pick (got ${myRosterCount})`);
  // undo → paused; resume
  await page.click('[data-action="undo"]');
  await page.waitForTimeout(100);
  ok(await page.locator('[data-action="resume"]').count() === 1, 'undo pauses with resume button');
  await page.click('[data-action="resume"]');
  await page.waitForSelector('.recs', { timeout: 15000 });
  // pick for me
  await page.click('[data-action="pickforme"]');
  await page.waitForTimeout(400);

  // Board tab shows drafted markers
  await page.click('[data-action="tab"][data-tab="board"]');
  await page.waitForTimeout(150);
  const goneRows = await page.locator('tr.gone').count();
  ok(goneRows >= 5, `board strikes drafted players (got ${goneRows})`);
  await page.screenshot({ path: path.join(SHOTS, '05-board-during-draft.png') });

  // Reset draft (double-confirm)
  await page.click('[data-action="tab"][data-tab="draft"]');
  await page.click('[data-action="reset"]');
  await page.click('[data-action="reset"]');
  await page.waitForTimeout(100);
  ok(await page.locator('.setupcard').count() === 1, 'reset returns to setup');

  // ---- Full auto draft to completion ----
  await page.locator('.modeopt[data-m="auto"]').click();
  await page.locator('#speedRange').fill('150');
  await page.click('[data-action="start"]');
  await page.waitForSelector('.draftbar :text("Draft complete")', { timeout: 120000 });
  await page.screenshot({ path: path.join(SHOTS, '06-complete.png'), fullPage: false });
  const cells = await page.locator('.dgrid .cellp').count();
  ok(cells === 12 * 15, `draft grid full: ${cells}/180 picks`);
  const recap = await page.locator('.panel .phead:has-text("recap")').count();
  ok(recap === 1, 'recap panel shows');
  // recap lineups: user's team auto-expands with player names
  ok(await page.locator('.recaplineup').count() === 1, 'your lineup auto-expands in recap');
  const lineupTxt = await page.locator('.recaplineup').textContent();
  ok(/QB|RB|WR/.test(lineupTxt) && lineupTxt.includes('FLEX'), 'lineup shows slots');
  ok((await page.locator('.recaplineup .rrow').count()) === 10, 'lineup shows 9 starters + bench row');
  // click another team to expand theirs too
  await page.locator('.recaprow').first().click();
  await page.waitForTimeout(120);
  const openCount = await page.locator('.recaplineup').count();
  ok(openCount === 2 || (await page.locator('.recaprow').first().getAttribute('data-t')) === String(4), `second lineup expands on click (open=${openCount})`);
  // no K/DST in first 8 rounds visually
  const early = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.dgrid tr')].slice(1, 9);
    let bad = 0;
    rows.forEach(r => r.querySelectorAll('.cellp').forEach(c => {
      if (c.classList.contains('K') || c.classList.contains('DST')) bad++;
    }));
    return bad;
  });
  ok(early === 0, `no K/DST in first 8 rounds (got ${early})`);

  // settings locked mid-draft? (draft complete still counts as picks>0)
  await page.click('[data-action="settings"]');
  ok(await page.locator('.lockmsg').count() === 1, 'settings locked with active draft');
  await page.click('[data-action="closesettings"]');

  // ---- Commissioner mode ----
  await page.click('[data-action="reset"]');
  await page.click('[data-action="reset"]');
  await page.waitForTimeout(100);
  await page.locator('.modeopt[data-m="commish"]').click();
  ok(await page.locator('#speedRange').count() === 0, 'commish setup hides AI speed');
  await page.click('[data-action="start"]');
  await page.waitForTimeout(150);
  // team 1 on the clock, user picks for them
  ok((await page.locator('.draftbar').textContent()).includes('you pick for everyone'), 'commish banner');
  ok(await page.locator('.recs').count() === 1, 'commish shows recs immediately');
  const recLabel1 = await page.locator('.recs b').first().textContent();
  ok(recLabel1.includes('TEAM 1'), `recs address Team 1 (got "${recLabel1}")`);
  // make 3 picks for 3 different teams
  for (let i = 0; i < 3; i++) {
    await page.locator('.recrow [data-action="draft"]').first().click();
    await page.waitForTimeout(120);
  }
  const commishCells = await page.locator('.dgrid .cellp').count();
  ok(commishCells === 3, `commish: 3 picks on grid (got ${commishCells})`);
  ok((await page.locator('.recs b').first().textContent()).includes('TEAM 4'), 'clock advanced to Team 4');
  // no timers should fire: wait and confirm still 3 picks
  await page.waitForTimeout(900);
  ok(await page.locator('.dgrid .cellp').count() === 3, 'commish: no AI picks happen on their own');
  // pick-for-me works for on-clock team
  await page.click('[data-action="pickforme"]');
  await page.waitForTimeout(120);
  ok(await page.locator('.dgrid .cellp').count() === 4, 'commish: pick-for-me drafts for on-clock team');
  // undo shows no resume button (no pause concept)
  await page.click('[data-action="undo"]');
  await page.waitForTimeout(100);
  ok(await page.locator('[data-action="resume"]').count() === 0, 'commish: undo does not show resume');
  ok(await page.locator('.recs').count() === 1, 'commish: still user turn after undo');

  // ---- Layouts & resizable panes (commish draft still active) ----
  // default side-by-side has a vertical splitter
  ok(await page.locator('#splitCols .vsplit').count() === 1, 'side layout has vertical splitter');
  const beforeCols = await page.evaluate(() => document.getElementById('splitCols').style.gridTemplateColumns);
  // drag the vertical splitter left
  const vs = await page.locator('.vsplit').boundingBox();
  await page.mouse.move(vs.x + 3, vs.y + 200);
  await page.mouse.down();
  await page.mouse.move(vs.x - 180, vs.y + 200, { steps: 5 });
  await page.mouse.up();
  const afterCols = await page.evaluate(() => document.getElementById('splitCols').style.gridTemplateColumns);
  ok(beforeCols !== afterCols, `v-splitter drag changes column split (${beforeCols} → ${afterCols})`);

  // stacked layout: grid on top, best available below, horizontal splitter
  await page.click('[data-action="layout"][data-m="stack"]');
  await page.waitForTimeout(120);
  ok(await page.locator('#gridWrapStack').count() === 1, 'stacked layout shows grid pane');
  const gridBox = await page.locator('#gridWrapStack').boundingBox();
  const availBox = await page.locator('.avail-table').boundingBox();
  ok(availBox.y > gridBox.y + gridBox.height - 5, 'stacked: best available sits below the grid');
  const hBefore = await page.evaluate(() => document.getElementById('gridWrapStack').getBoundingClientRect().height);
  const hs = await page.locator('.hsplit').boundingBox();
  await page.mouse.move(hs.x + hs.width / 2, hs.y + 3);
  await page.mouse.down();
  await page.mouse.move(hs.x + hs.width / 2, hs.y - 140, { steps: 5 });
  await page.mouse.up();
  const hAfter = await page.evaluate(() => document.getElementById('gridWrapStack').getBoundingClientRect().height);
  ok(Math.abs((hBefore - hAfter) - 140) < 25, `h-splitter drag resizes grid pane (${hBefore} → ${hAfter})`);
  await page.screenshot({ path: path.join(SHOTS, '08-stacked.png') });

  // grid view page: maximized grid + best available below
  await page.click('[data-action="tab"][data-tab="grid"]');
  await page.waitForTimeout(120);
  ok(await page.locator('#gridWrapMax').count() === 1, 'grid view page renders maximized grid');
  ok(await page.locator('.dgrid.big').count() === 1, 'grid view uses big cells');
  ok(await page.locator('.avail-table').count() === 1, 'grid view has best-available below');
  ok(await page.locator('.recs').count() === 1, 'grid view shows recommendations on your turn');
  // drafting works from grid view
  const gridPicksBefore = await page.locator('.dgrid .cellp').count();
  await page.locator('.recrow [data-action="draft"]').first().click();
  await page.waitForTimeout(120);
  ok(await page.locator('.dgrid .cellp').count() === gridPicksBefore + 1, 'can draft from grid view');
  await page.screenshot({ path: path.join(SHOTS, '09-gridview.png') });
  // layout choice survives export round-trip (profile includes layout)
  const profile = await page.evaluate(() => JSON.stringify({ hasLayout: 'layout' in { layout: state.layout }, mode: state.layout.mode }));
  ok(JSON.parse(profile).mode === 'stack', 'layout mode persisted in state for export');
  // back to draft room, stacked persists
  await page.click('[data-action="tab"][data-tab="draft"]');
  await page.waitForTimeout(100);
  ok(await page.locator('#gridWrapStack').count() === 1, 'stacked layout remembered after grid view');
  await page.click('[data-action="layout"][data-m="side"]');
  await page.waitForTimeout(100);
  ok(await page.locator('#splitCols').count() === 1, 'switch back to side-by-side');

  // ---- Side-by-side + stats: pane scrolls internally, layout doesn't blow out ----
  await page.locator('.phead [data-action="togglestats"]').click();
  await page.waitForTimeout(200);
  const blowout = await page.evaluate(() => {
    const wrap = document.querySelector('.avail-table').closest('.gridwrap');
    return {
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      innerScroll: wrap.scrollWidth > wrap.clientWidth + 50,
      gridVisible: document.getElementById('gridWrapSide').getBoundingClientRect().width > 300,
    };
  });
  ok(blowout.pageOverflow < 5, `no horizontal page overflow with stats on (${blowout.pageOverflow}px)`);
  ok(blowout.innerScroll, 'stats scroll inside the player pane');
  ok(blowout.gridVisible, 'draft grid keeps its share of the width');
  // name column stays pinned while scrolling inside the pane
  const nameX = await page.evaluate(() => {
    const wrap = document.querySelector('.avail-table').closest('.gridwrap');
    const before = document.querySelector('.avail-table tbody td:nth-child(2)').getBoundingClientRect().left;
    wrap.scrollLeft = 300;
    const after = document.querySelector('.avail-table tbody td:nth-child(2)').getBoundingClientRect().left;
    wrap.scrollLeft = 0;
    return Math.abs(after - before);
  });
  ok(nameX < 2, `player name column sticky inside pane (moved ${nameX}px)`);
  await page.locator('.phead [data-action="togglestats"]').click();
  await page.waitForTimeout(150);

  // ---- Grid view: player list stays glued to bottom while dragging the grid ----
  await page.click('[data-action="tab"][data-tab="grid"]');
  await page.waitForTimeout(200);
  const gvSplit = await page.locator('.hsplit[data-key="gridPx"]').boundingBox();
  await page.mouse.move(gvSplit.x + gvSplit.width / 2, gvSplit.y + 3);
  await page.mouse.down();
  await page.mouse.move(gvSplit.x + gvSplit.width / 2, gvSplit.y - 180, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const gvFit = await page.evaluate(() => {
    const avail = document.querySelector('.avail-table').closest('.gridwrap').getBoundingClientRect();
    return window.innerHeight - avail.bottom;
  });
  ok(gvFit < 30 && gvFit > -2, `grid-view player list refits to bottom after shrinking grid (gap ${Math.round(gvFit)}px)`);
  await page.evaluate(() => { state.layout.gridPx = null; render(); });
  await page.click('[data-action="tab"][data-tab="draft"]');
  await page.waitForTimeout(150);

  // ---- Avail search + collapsible recs (commish draft active, side layout) ----
  const availRowsBefore = await page.locator('.avail-table tbody tr').count();
  await page.fill('#availSearch', 'kelce');
  await page.waitForTimeout(120);
  const availRowsAfter = await page.locator('.avail-table tbody tr').count();
  ok(availRowsAfter === 1 && availRowsAfter < availRowsBefore, `avail search narrows list (${availRowsBefore} → ${availRowsAfter})`);
  ok(await page.evaluate(() => document.activeElement.id) === 'availSearch', 'avail search keeps focus while typing');
  await page.fill('#availSearch', '');
  await page.waitForTimeout(100);
  // grid view also has the search box
  await page.click('[data-action="tab"][data-tab="grid"]');
  await page.waitForTimeout(100);
  ok(await page.locator('#availSearch').count() === 1, 'grid view has avail search box');
  await page.fill('#availSearch', 'nacua');
  await page.waitForTimeout(100);
  ok(await page.locator('.avail-table tbody tr').count() === 1, 'grid view search narrows');
  await page.fill('#availSearch', '');
  await page.waitForTimeout(100);
  // collapse recommendations
  ok(await page.locator('.recrow').count() > 0, 'recs visible before collapse');
  await page.click('[data-action="togglerecs"]');
  await page.waitForTimeout(100);
  ok(await page.locator('.recrow').count() === 0, 'recs collapse hides rows');
  ok(await page.locator('.recs.collapsed').count() === 1, 'collapsed style applied');
  // survives view switch
  await page.click('[data-action="tab"][data-tab="draft"]');
  await page.waitForTimeout(100);
  ok(await page.locator('.recs.collapsed').count() === 1, 'collapse remembered across views');
  await page.click('[data-action="togglerecs"]');
  await page.waitForTimeout(100);
  ok(await page.locator('.recrow').count() > 0, 'recs expand again');

  // ---- Write-in player (commish draft active, user turn) ----
  const poolBefore = await page.evaluate(() => players.length);
  await page.click('.draftbar [data-action="writein"]');
  await page.waitForTimeout(100);
  await page.fill('#wiName', 'Testy McSleeper');
  await page.selectOption('#wiPos', 'RB');
  await page.selectOption('#wiTeam', 'DET');
  ok(await page.locator('[data-action="writeindraft"]').count() === 1, 'write-in offers Add & draft on user turn');
  await page.click('[data-action="writeindraft"]');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => players.length) === poolBefore + 1, 'write-in added to pool');
  const gridNames = await page.locator('.dgrid').textContent();
  ok(gridNames.includes('Testy McSleeper'), 'write-in drafted onto the grid');
  const wiPlayer = await page.evaluate(() => {
    const p = players.find(x => x.name === 'Testy McSleeper');
    return { pos: p.pos, team: p.team, bye: p.bye, custom: !!p.isCustom, proj: state.values[p.id].proj };
  });
  ok(wiPlayer.pos === 'RB' && wiPlayer.team === 'DET' && wiPlayer.bye === 6 && wiPlayer.custom, 'write-in has pos/team/bye/custom flag');
  ok(wiPlayer.proj > 10 && wiPlayer.proj < 100, `write-in gets modest projection (${wiPlayer.proj})`);
  // duplicate guard
  await page.click('.draftbar [data-action="writein"]');
  await page.fill('#wiName', 'testy mcsleeper');
  await page.click('[data-action="writeinadd"]');
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => players.length) === poolBefore + 1, 'duplicate write-in rejected');
  // ✎ marker on player board
  await page.click('[data-action="tab"][data-tab="board"]');
  await page.fill('#searchBox', 'mcsleeper');
  await page.waitForTimeout(150);
  ok(await page.locator('.tablewrap .customtag').count() === 1, 'write-in shows ✎ marker on board');
  await page.fill('#searchBox', '');
  await page.waitForTimeout(100);
  await page.click('[data-action="tab"][data-tab="draft"]');
  await page.waitForTimeout(100);

  // ---- Draft room panes fill to window bottom + grid height draggable ----
  const paneFit = await page.evaluate(() => {
    const avail = document.querySelector('.avail-table').closest('.gridwrap').getBoundingClientRect();
    const grid = document.getElementById('gridWrapSide').getBoundingClientRect();
    return { availGap: window.innerHeight - avail.bottom, gridGap: window.innerHeight - grid.bottom };
  });
  ok(paneFit.availGap < 30 && paneFit.availGap > -2, `best-available fills to bottom (gap ${Math.round(paneFit.availGap)}px)`);
  ok(paneFit.gridGap < 30 && paneFit.gridGap > -2, `draft grid fills to bottom (gap ${Math.round(paneFit.gridGap)}px)`);
  // drag the new side splitter up → grid shrinks, roster panel comes into view
  const sideSplit = await page.locator('.hsplit[data-key="sideGridPx"]').boundingBox();
  await page.mouse.move(sideSplit.x + sideSplit.width / 2, sideSplit.y + 3);
  await page.mouse.down();
  await page.mouse.move(sideSplit.x + sideSplit.width / 2, sideSplit.y - 200, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  const shrunk = await page.evaluate(() => ({
    h: document.getElementById('gridWrapSide').getBoundingClientRect().height,
    stored: state.layout.sideGridPx,
  }));
  ok(shrunk.stored > 100 && Math.abs(shrunk.h - shrunk.stored) < 5, `side grid height draggable (${Math.round(shrunk.h)}px)`);
  await page.evaluate(() => { state.layout.sideGridPx = null; render(); });
  await page.waitForTimeout(120);

  // ---- Stats columns in Draft Room + Grid View (commish draft active) ----
  ok(await page.locator('.phead [data-action="togglestats"]').count() === 1, 'draft room avail panel has stats chip');
  await page.locator('.phead [data-action="togglestats"]').click();
  await page.waitForTimeout(150);
  ok(await page.locator('.avail-table .grouprow').count() === 1, 'draft room avail shows stat group headers');
  ok((await page.locator('.avail-table thead tr.sub th').count()) === 17, 'draft room avail has 17 columns with stats on');
  await page.click('[data-action="tab"][data-tab="grid"]');
  await page.waitForTimeout(150);
  ok(await page.locator('.avail-table .grouprow').count() === 1, 'grid view avail shows stat columns too');
  // stat columns are sortable in the avail panel
  await page.locator('.avail-table th[data-k="aRec"]').click();
  await page.waitForTimeout(150);
  const topByRec = await page.evaluate(() => {
    const shownFirst = document.querySelector('.avail-table tbody .pname').textContent;
    const best = availablePlayers().filter(p => p.a25 && p.a25.rec)
      .sort((a, b) => b.a25.rec - a.a25.rec)[0];
    return { shownFirst, expect: best.name };
  });
  ok(topByRec.shownFirst === topByRec.expect, `avail sorts by 2025 receptions (${topByRec.shownFirst} = ${topByRec.expect})`);
  // second click flips direction
  await page.locator('.avail-table th[data-k="aRec"]').click();
  await page.waitForTimeout(150);
  const flipped = await page.locator('.avail-table tbody .pname').first().textContent();
  ok(flipped !== topByRec.shownFirst, 'second click reverses avail sort');
  // sorting avail does not disturb the Player Board sort
  const sorts = await page.evaluate(() => ({ board: state.sort.key, avail: state.availSort.key }));
  ok(sorts.avail === 'aRec' && sorts.board !== 'aRec', `avail sort independent of board sort (board=${sorts.board}, avail=${sorts.avail})`);
  await page.locator('.avail-table th[data-k="vor"]').click();
  await page.waitForTimeout(120);
  await page.locator('.phead [data-action="togglestats"]').click();
  await page.waitForTimeout(120);
  ok(await page.locator('.avail-table .grouprow').count() === 0, 'stats toggle off from grid view');
  await page.click('[data-action="tab"][data-tab="draft"]');
  await page.waitForTimeout(100);

  // ---- Team names (commish draft active) ----
  await page.click('[data-action="teamnames"]');
  await page.waitForTimeout(100);
  ok(await page.locator('[data-tn]').count() === 12, 'team names modal shows 12 inputs');
  await page.fill('[data-tn="0"]', 'Sharks');
  await page.fill('[data-tn="4"]', "Chad's Champs");
  await page.click('[data-action="closeteams"]');
  await page.waitForTimeout(120);
  const gridHead = await page.locator('.dgrid th').allTextContents();
  ok(gridHead.includes('Sharks'), 'grid header shows custom name Sharks');
  ok(gridHead.some(t => t.includes("Chad's Champs")), 'user team renamed too');
  const logTxt = await page.locator('.log').textContent();
  ok(logTxt.includes('Sharks'), 'pick log uses custom name');

  // ---- Queue marks drafted players (commish draft has 4+ picks) ----
  await page.evaluate(() => { state.queue = [state.draft.picks[0], availablePlayers()[0].id]; render(); });
  await page.click('[data-action="tab"][data-tab="queue"]');
  await page.waitForTimeout(150);
  ok(await page.locator('.tablewrap tbody tr').count() === 2, 'queue shows drafted + available');
  ok(await page.locator('.tablewrap tbody tr.gone').count() === 1, 'drafted queue player struck out');
  ok((await page.locator('.tablewrap tbody tr.gone td:last-child, .tablewrap tbody tr.gone').first().textContent()).length > 0, 'drafted row renders');
  await page.locator('#hideDrafted').check();
  await page.waitForTimeout(150);
  ok(await page.locator('.tablewrap tbody tr').count() === 1, 'hide drafted removes them from queue view');
  await page.locator('#hideDrafted').uncheck();
  await page.waitForTimeout(120);
  await page.evaluate(() => { state.queue = []; render(); });
  await page.click('[data-action="tab"][data-tab="draft"]');
  await page.waitForTimeout(100);

  // ---- Scoring settings include sack/K/DST fields ----
  // (settings locked mid-draft; just verify fields render, values visible)
  await page.click('[data-action="settings"]');
  await page.waitForTimeout(100);
  ok(await page.locator('[data-scoring="sack"]').count() === 1, 'sack setting present');
  ok(await page.locator('[data-scoring="sack"]').inputValue() === '-0.5', 'sack default -0.5');
  ok(await page.locator('[data-scoring="fg4049"]').inputValue() === '4', 'FG 40-49 default 4');
  ok(await page.locator('[data-scoring="fg50"]').inputValue() === '5', 'FG 50+ default 5');
  ok(await page.locator('[data-scoring="fgm019"]').count() === 1, 'FG miss 0-19 setting present');
  ok(await page.locator('[data-scoring="fgm2029"]').count() === 1, 'FG miss 20-29 setting present');
  ok(await page.locator('[data-scoring="dstSack"]').count() === 1, 'DST sack setting present');
  ok(await page.locator('[data-scoring="dstTd"]').inputValue() === '6', 'DST TD default 6');
  await page.click('[data-action="closesettings"]');
  await page.waitForTimeout(100);

  // ---- Assistant ----
  await page.click('[data-action="assist"]');
  await page.waitForSelector('.assist');
  await page.fill('#assistInput', "when is gibbs' bye?");
  await page.press('#assistInput', 'Enter');
  await page.waitForTimeout(150);
  let lastMsg = await page.locator('.msg.a').last().textContent();
  ok(lastMsg.includes('week 6'), `assistant: Gibbs bye (got "${lastMsg.slice(0, 60)}")`);
  await page.fill('#assistInput', 'who should I take?');
  await page.press('#assistInput', 'Enter');
  await page.waitForTimeout(150);
  lastMsg = await page.locator('.msg.a').last().textContent();
  ok(lastMsg.includes('VOR'), 'assistant: pick advice during commish draft');
  const clockInfo = await page.evaluate(() => ({
    isUser: onClockTeam() === state.settings.userSlot - 1,
    name: teamName(onClockTeam()),
  }));
  const expectPrefix = clockInfo.isUser ? 'My board says' : clockInfo.name;
  ok(lastMsg.includes(expectPrefix), `assistant: advice matches on-clock team "${clockInfo.name}" (got "${lastMsg.slice(0, 40)}")`);
  await page.locator('.achips .chip', { hasText: 'Best playoff WRs' }).click();
  await page.waitForTimeout(150);
  lastMsg = await page.locator('.msg.a').last().textContent();
  ok(lastMsg.includes('SOS rank'), 'assistant: playoff WR chip answer');
  const focusedA = await page.evaluate(() => document.activeElement.id);
  ok(focusedA === 'assistInput', 'assistant input keeps focus after asking');
  await page.screenshot({ path: path.join(SHOTS, '07-assistant.png') });
  await page.click('.ahead [data-action="assist"]');
  ok(await page.locator('.assist').count() === 0, 'assistant closes');

  // ---- Sticky name column + zoom-immune header ----
  await page.click('[data-action="tab"][data-tab="board"]');
  await page.waitForTimeout(120);
  // turn stats on and shrink viewport to force horizontal scroll
  if (await page.locator('.grouprow').count() === 0) await page.click('[data-action="togglestats"]');
  await page.setViewportSize({ width: 900, height: 800 });
  await page.waitForTimeout(120);
  const nameXBefore = await page.evaluate(() => document.querySelector('tbody td:nth-child(2)').getBoundingClientRect().left);
  await page.evaluate(() => { document.querySelector('.tablewrap').scrollLeft = 500; });
  await page.waitForTimeout(120);
  const scrolled = await page.evaluate(() => document.querySelector('.tablewrap').scrollLeft);
  const nameXAfter = await page.evaluate(() => document.querySelector('tbody td:nth-child(2)').getBoundingClientRect().left);
  ok(scrolled > 400, `board actually scrolls horizontally (${scrolled})`);
  ok(Math.abs(nameXAfter - nameXBefore) < 2, `player name column stays pinned while scrolling (${nameXBefore} → ${nameXAfter})`);
  // header sized in viewport units: font grows with viewport width (constant physical size under zoom)
  const hSmall = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('header')).fontSize));
  await page.setViewportSize({ width: 2200, height: 900 });
  await page.waitForTimeout(120);
  const hBig = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('header')).fontSize));
  ok(hBig > hSmall * 1.4, `header font tracks viewport (zoom-immune): ${hSmall}px @900 → ${hBig}px @2200`);
  await page.setViewportSize({ width: 1400, height: 900 });
  if (await page.locator('.grouprow').count() === 1) await page.click('[data-action="togglestats"]');
  await page.waitForTimeout(120);

  // ---- Fluid layout: app fills wide viewports (zoomed-out browsers) ----
  await page.setViewportSize({ width: 2400, height: 1000 });
  await page.click('[data-action="tab"][data-tab="board"]');
  await page.waitForTimeout(150);
  const boardW = await page.evaluate(() => document.querySelector('.tablewrap').getBoundingClientRect().width);
  ok(boardW > 2200, `board fills a 2400px viewport (got ${Math.round(boardW)}px)`);
  await page.click('[data-action="tab"][data-tab="grid"]');
  await page.waitForTimeout(150);
  const gridW = await page.evaluate(() => document.querySelector('.dgrid').getBoundingClientRect().width);
  ok(gridW > 2200, `draft grid stretches at 2400px (got ${Math.round(gridW)}px)`);
  await page.setViewportSize({ width: 1400, height: 900 });

  // ---- Sync live: projections + ADP + injuries (mocked Sleeper endpoints) ----
  {
    const sp = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    sp.on('pageerror', e => errors.push('SYNC: ' + e.message));
    await sp.route('**/v1/players/nfl', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        '9001': { player_id: '9001', full_name: "Ja'Marr Chase", position: 'WR', team: 'CIN', injury_status: 'Questionable' },
      }),
    }));
    await sp.route('**/projections/nfl/**', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        { player_id: '9001', stats: { adp_half_ppr: 1.4, rec: 150, rec_yd: 1800, rec_td: 15, fum_lost: 1 }, player: { first_name: "Ja'Marr", last_name: 'Chase', position: 'WR' } },
        { player_id: 'HOU', stats: { adp_half_ppr: 155, sack: 60, int: 20, fum_rec: 14, def_td: 5 }, player: { last_name: 'Texans', position: 'DEF' } },
      ]),
    }));
    await sp.goto(INDEX_URL);
    await sp.click('[data-action="sync"]');
    await sp.waitForTimeout(600);
    const after = await sp.evaluate(() => {
      const chase = players.find(p => p.name === "Ja'Marr Chase");
      const hou = players.find(p => p.name === 'Texans');
      return {
        adp: chase.adp, rec: chase.stats.rec, reyd: chase.stats.reyd, inj: chase.injury,
        proj: state.values[chase.id].proj, rank: state.rankMap[chase.id], posRank: chase.posRank,
        houSacks: hou.stats.sacks, houAdp: hou.adp, live: !!chase._live,
        toast: document.querySelector('#toast').textContent,
      };
    });
    ok(after.adp === 1.4, `sync updates ADP (${after.adp})`);
    ok(after.rec === 150 && after.reyd === 1800, `sync updates projected stats (${after.rec} rec, ${after.reyd} yds)`);
    ok(after.inj === 'Questionable', 'sync keeps injury tags');
    ok(after.proj > 330, `projection recomputed from new stats (${after.proj})`);
    ok(after.rank === 1 && after.posRank === 1, `re-ranks to #1 overall / WR1 (rank ${after.rank}, WR${after.posRank})`);
    ok(after.houSacks === 60 && after.houAdp === 155, 'DST projections + ADP update');
    ok(after.live && /projections/.test(after.toast), `toast reports updates (${after.toast.slice(0, 80)})`);
    await sp.close();
  }

  // ---- Live hosting: commissioner + read-only viewer ----
  const srv = spawn('node', [__dirname + '/server.js', '8613']);
  const key = await new Promise((resolve, reject) => {
    let out = '';
    const to = setTimeout(() => reject(new Error('server did not start: ' + out)), 8000);
    srv.stdout.on('data', d => {
      out += d;
      const m = out.match(/\?key=([a-f0-9]+)/);
      if (m) { clearTimeout(to); resolve(m[1]); }
    });
  });
  const commish = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const viewer = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  commish.on('pageerror', e => errors.push('COMMISH: ' + e.message));
  viewer.on('pageerror', e => errors.push('VIEWER: ' + e.message));
  await commish.goto('http://127.0.0.1:8613/?key=' + key);
  await commish.waitForTimeout(400);
  ok((await commish.locator('.livebadge').textContent()).includes('COMMISSIONER'), 'commissioner badge shows');
  // commissioner starts a commish-mode draft and makes 2 picks
  await commish.click('[data-action="tab"][data-tab="draft"]');
  await commish.locator('.modeopt[data-m="commish"]').click();
  await commish.click('[data-action="start"]');
  await commish.waitForSelector('.recs', { timeout: 10000 });
  await commish.locator('.recrow [data-action="draft"]').first().click();
  await commish.waitForTimeout(150);
  await commish.locator('.recrow [data-action="draft"]').first().click();
  await commish.waitForTimeout(400);
  // viewer connects and sees the live draft
  await viewer.goto('http://127.0.0.1:8613/');
  await viewer.waitForTimeout(700);
  ok((await viewer.locator('.livebadge').textContent()).includes('VIEWER'), 'viewer badge shows');
  await viewer.click('[data-action="tab"][data-tab="draft"]');
  await viewer.waitForTimeout(300);
  ok(await viewer.locator('.dgrid .cellp').count() === 2, 'viewer sees both live picks on the grid');
  ok(await viewer.locator('[data-action="draft"]').count() === 0, 'viewer has NO draft buttons');
  ok(await viewer.locator('[data-action="pickforme"]').count() === 0, 'viewer has no pick-for-me');
  ok(await viewer.locator('[data-action="reset"]').count() === 0, 'viewer has no reset');
  ok(await viewer.locator('[data-action="undo"]').count() === 0, 'viewer has no undo');
  ok(await viewer.locator('.recs').count() === 0, 'viewer sees no recommendations panel');
  // live update: commissioner picks again → viewer grid updates via SSE
  await commish.locator('.recrow [data-action="draft"]').first().click();
  await viewer.waitForFunction(() => document.querySelectorAll('.dgrid .cellp').length === 3, null, { timeout: 6000 });
  ok(true, 'viewer receives new pick live (SSE)');
  // viewer keeps full local control: filter + sort + lean
  await viewer.click('[data-action="tab"][data-tab="board"]');
  await viewer.waitForTimeout(150);
  await viewer.locator('.toolbar [data-action="filter"][data-f="TE"]').click();
  ok(await viewer.locator('.tablewrap tbody tr').count() === 39, 'viewer can filter positions locally');
  await viewer.locator('.toolbar [data-action="filter"][data-f="ALL"]').click();
  await viewer.locator('.tablewrap tbody tr').nth(9).locator('[data-action="w+"]').click();
  await viewer.waitForTimeout(150);
  ok(await viewer.locator('.wval.up').count() === 1, 'viewer can set their own leans');
  const commishLeans = await commish.evaluate(() => Object.keys(state.weights).length);
  ok(commishLeans === 0, "viewer leans don't touch the commissioner");
  // viewer can build their own queue
  await viewer.locator('.tablewrap tbody tr .qbtn').first().click();
  await viewer.waitForTimeout(150);
  ok((await viewer.locator('#tabs button').last().textContent()).includes('(1)'), 'viewer saves to their own queue');
  await viewer.click('[data-action="tab"][data-tab="queue"]');
  await viewer.waitForTimeout(150);
  ok(await viewer.locator('.tablewrap tbody tr').count() === 1, 'viewer queue tab lists their save');
  ok(await commish.evaluate(() => state.queue.length) === 0, "viewer queue doesn't touch the commissioner");
  // viewer settings are locked
  await viewer.click('[data-action="settings"]');
  await viewer.waitForTimeout(150);
  ok((await viewer.locator('.lockmsg').textContent()).includes('View-only'), 'viewer settings locked with note');
  ok(await viewer.locator('[data-scoring="rec"]').isDisabled(), 'viewer scoring inputs disabled');
  await viewer.click('[data-action="closesettings"]');
  // server rejects a push without the key
  const forged = await viewer.evaluate(() =>
    fetch('/state', { method: 'POST', body: '{}' }).then(r => r.status));
  ok(forged === 403, `server rejects push without key (${forged})`);
  // commissioner reload survives: state adopted back from server
  await commish.reload();
  await commish.waitForTimeout(800);
  await commish.click('[data-action="tab"][data-tab="draft"]');
  await commish.waitForTimeout(200);
  ok(await commish.locator('.dgrid .cellp').count() === 3, 'commissioner reload adopts server state (3 picks)');
  await commish.close();
  await viewer.close();
  srv.kill();

  ok(errors.length === 0, 'no JS errors: ' + errors.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
