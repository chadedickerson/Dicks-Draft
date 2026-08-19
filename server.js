#!/usr/bin/env node
// Draft Lab '26 — live draft server. Zero dependencies; plain Node.
//
//   node server.js [port]
//
// Prints two URLs:
//   • Viewer URL      — share with your league. Read-only live board:
//                       they can sort/filter/search/lean locally, but every
//                       pick you make appears on their screen instantly.
//   • Commissioner URL — keep private (it carries your key). Only requests
//                       with this key can change the shared draft state.
//
// Everyone must be able to reach your machine (same Wi-Fi/LAN, or a
// port-forward if hosting over the internet).

const http = require('http');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const path = require('path');

const PORT = parseInt(process.argv[2] || process.env.PORT || '8080', 10);
const KEY = crypto.randomBytes(8).toString('hex');
const INDEX = path.join(__dirname, 'index.html');

let sharedState = null;              // last state pushed by the commissioner
let stateVersion = 0;
const sseClients = new Set();

function broadcast() {
  const msg = `data: ${JSON.stringify({ v: stateVersion, state: sharedState })}\n\n`;
  for (const res of sseClients) { try { res.write(msg); } catch (e) { sseClients.delete(res); } }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const route = url.pathname;

  if (route === '/' && req.method === 'GET') {
    let html;
    try { html = fs.readFileSync(INDEX); }
    catch (e) { res.writeHead(500); return res.end('index.html not found next to server.js'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(html);
  }

  if (route === '/state' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ v: stateVersion, state: sharedState }));
  }

  if (route === '/state' && req.method === 'POST') {
    if (url.searchParams.get('key') !== KEY) { res.writeHead(403); return res.end('bad key'); }
    let body = '';
    req.on('data', c => { body += c; if (body.length > 2e6) req.destroy(); });
    req.on('end', () => {
      try {
        sharedState = JSON.parse(body);
        stateVersion++;
        broadcast();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, v: stateVersion, viewers: sseClients.size }));
      } catch (e) { res.writeHead(400); res.end('bad json'); }
    });
    return;
  }

  if (route === '/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify({ v: stateVersion, state: sharedState })}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  res.writeHead(404); res.end('not found');
});

// keep SSE connections alive through proxies
setInterval(() => { for (const res of sseClients) { try { res.write(': ping\n\n'); } catch (e) {} } }, 25000);

server.listen(PORT, '0.0.0.0', () => {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  const host = ips[0] || 'localhost';
  console.log('');
  console.log('🏈 Draft Lab \'26 live server running');
  console.log('──────────────────────────────────────────────────');
  console.log(`  Viewers (share this):     http://${host}:${PORT}/`);
  for (const ip of ips.slice(1)) console.log(`                    or:     http://${ip}:${PORT}/`);
  console.log(`  Commissioner (private):   http://${host}:${PORT}/?key=${KEY}`);
  console.log('──────────────────────────────────────────────────');
  console.log('  Viewers are read-only; only the commissioner URL can draft.');
  console.log('  Everyone must be on a network that can reach this machine.');
  console.log('');
});
