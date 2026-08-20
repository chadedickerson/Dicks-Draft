# Dick's Draft '26 — Fantasy Football Draft Board & Simulator

<p align="left">
  <img src="./dicks-picks-image.jpeg" alt="Dicks-Draft Logo" width="300" />
</p>

A single-file, zero-dependency browser app: open `index.html` in any browser. No install, no server, works offline.

## Hosting a live draft (commissioner + viewers)

To let your league watch the draft live from their own devices:

```bash
node server.js          # or: node server.js 9000 for a custom port
```

It prints two URLs:

- **Viewer URL** (`http://<your-ip>:8080/`) — share this. Viewers get a live, read-only board: every pick you make appears on their screen instantly, but they can't draft, undo, or touch league settings. They CAN sort, filter positions, search, view stats, and set their own leans — all local to their screen, without affecting yours.
- **Commissioner URL** (with `?key=...`) — keep this one private; it's yours. Only requests carrying that key can change the shared state. If you reload your page mid-draft, it re-adopts the draft from the server.

Requirements: Node.js installed (`node -v` to check; nodejs.org if not), and viewers must be able to reach your machine — same Wi-Fi/LAN works out of the box; hosting for remote friends needs a port-forward on your router (or a tunnel like Tailscale/ngrok). Opening `index.html` directly from disk still works exactly as before — the live features only wake up when served by `server.js`.

## Deploying to Railway (public hosting)

The repo is deploy-ready: `package.json` declares `npm start` → `node server.js`, the server honors Railway's `PORT`, has zero runtime dependencies, and exposes `/healthz`.

1. Push this folder to a GitHub repo.
2. In Railway: **New Project → Deploy from GitHub repo**, pick the repo. It auto-detects Node and runs `npm start`.
3. In the service's **Variables**, add `COMMISH_KEY` = a long random string you make up. This is critical — without it a new key is generated on every restart/redeploy and your commissioner URL breaks mid-draft.
4. In **Settings → Networking**, click **Generate Domain**. That domain is the viewer URL to share; your private commissioner URL is `https://<domain>/?key=<your COMMISH_KEY>`.

Notes: draft state lives in memory, so a redeploy or crash between picks clears the server copy — your commissioner browser tab still holds the draft and re-pushes it automatically on its next change (or reload the commissioner URL to re-adopt whichever side has state). Anyone with the public URL can watch; only the key can change anything. SSE live updates work fine over Railway's HTTPS proxy.

## What it does

- **Draft board** — 300 players ranked by expected fantasy output for *your* league: scoring (Standard / Half / Full PPR or fully custom per-stat values), team count (8–14), and roster shape all re-rank the board instantly.
- **Your lean** — bump any player up to ±5 steps bullish/bearish (±3% projection per step). Leans change *your* board and recommendations, but not ADP or the AI drafters — that's your edge in the sim.
- **VOR ranking** — players are ranked by Value Over Replacement: projected points minus the points of the "replacement level" player at that position, where replacement level is derived from your league size and roster (this is why a QB with 370 points can rank below a RB with 280).
- **Snake draft simulator** — three modes: manual (you draft from your slot, AI runs the rest), **commissioner** (you make every pick for every team — ideal for mirroring your real league's draft live), or full auto (watch the AI draft all teams). Draft grid, pick log, per-team rosters, undo, CSV export, projected-points recap.
- **Write-in players** — the ➕ Write-in button (Player Board and draft bar) adds anyone who isn't on the board: name, position, team. They get a modest late-round projection (90% of the weakest documented player at the position — use leans to bump them), a ✎ marker, and can be drafted immediately at the current pick. Write-ins persist in your exported profile. Ranks 1–200 are consensus-documented; 201–300 are a real-player depth pool whose team assignments refresh via Sleeper sync.
- **Stat columns** — the 📊 Stats toggle on the Player Board reveals 10 sortable columns: 2026 projected pass/rush/rec yards, receptions, and total TDs, plus the same five categories as actual 2025 season stats (from Pro-Football-Reference; "—" means rookie or missed season). Click any header to sort.
- **Grid View & flexible layouts** — a dedicated Grid View page shows the full draft grid maximized with the best-available list below it (you can draft straight from there). In the Draft Room, toggle side-by-side vs stacked layouts. Every divider is draggable: left/right in side-by-side, up/down in stacked and Grid View. Layout choices are saved in your exported profile.
- **Draft Assistant** — a built-in Q&A panel (🧠 button): ask "who should I take?", "best RBs left", "Gibbs or Bijan?", "bye conflicts on my roster", "best playoff WRs", "when should I draft a QB?", or "tell me about <player>". Answers use your scoring, your leans, live draft state, and embedded weeks 15–17 playoff schedules with matchup favorability. It's a rule-based engine over the data (fully offline), not a language model.
- **Sync live (Sleeper)** — pulls current team assignments and injury tags from the free Sleeper API and re-ranks. Requires internet; everything else works offline.
- **Export/Import profile** — saves your settings + leans to a JSON file (browser storage isn't used, so this is how state persists between sessions).

## Project structure (how it's built)

| File | Role |
|---|---|
| `data/rankings.csv` | Raw consensus rank order (source data) |
| `build_dataset.js` | Merges rankings + stat anchors → generates `players.js` |
| `core.js` | Pure logic, no DOM: scoring, VOR, snake order, AI draft brain. Runs in Node for testing and in the browser unchanged. |
| `playoff.js` | Weeks 15–17 opponents + matchup favorability per team |
| `assistant.js` | Draft Assistant Q&A engine (pure logic, intent matching over the data) |
| `ui.js` | All rendering + event handling (vanilla JS, event delegation) |
| `template.html` | Page skeleton + CSS with `/*__MARKERS__*/` |
| `assemble.js` | Stitches template + data + core + ui → `index.html` |
| `test_core.js` | 700+ unit tests incl. full simulated drafts across formats |
| `test_assistant.js` | Assistant intent tests (byes, playoffs, compares, advice) |
| `e2e.js` | Playwright browser test: clicks through board, weights, settings, manual + auto drafts |

Rebuild after any change:

```bash
node build_dataset.js && node test_core.js && node test_assistant.js && node assemble.js && node e2e.js
```

## Design decisions worth noting

- **Zero dependencies** — no React/CDN, so the file works from `file://` with no internet and can't break when a CDN changes.
- **Pure-logic core** — everything testable lives in `core.js` with no DOM references; the AI takes an injectable random source so drafts are reproducible in tests.
- **AI realism** — AI teams draft from an ADP-sorted window scored by VOR + roster need + jitter, with guards: no early kickers/defenses, no hoarding backup QBs/TEs early, urgency when a needed position's pool dries up, and forced need-filling in the endgame so every team fields a legal starting lineup.
- **Stat-level projections instead of stored fantasy points** — the only way scoring-format changes can honestly re-rank players.

