// Assembles the single-file app: template + data + core + ui → index.html
const fs = require('fs');
const read = f => fs.readFileSync(__dirname + '/' + f, 'utf8');
let html = read('template.html');
// strip the node-only exports
const noExport = f => read(f).replace(/if \(typeof module[^]*$/m, '');
html = html
  .replace('/*__PLAYER_DATA__*/', () => read('players.js'))
  .replace('/*__PLAYOFF__*/', () => noExport('playoff.js'))
  .replace('/*__CORE__*/', () => noExport('core.js'))
  .replace('/*__ASSISTANT__*/', () => noExport('assistant.js'))
  .replace('/*__UI__*/', () => read('ui.js'));
fs.writeFileSync(__dirname + '/index.html', html);
console.log('index.html:', (html.length / 1024).toFixed(0) + ' KB');
