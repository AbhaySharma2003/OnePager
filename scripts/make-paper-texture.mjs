// Renders the landing-page sample one-pager with the real renderer and saves it as the 3D paper texture.
// Run: node scripts/make-paper-texture.mjs   -> web/assets/paper-resume.jpg
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve('web');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf' };
const srv = http.createServer((q, s) => {
  if (q.url === '/__tex.html') { s.writeHead(200, { 'content-type': 'text/html' }); return s.end(`<!doctype html><meta charset=utf-8><link rel=stylesheet href="resume/resume.css"><link rel=stylesheet href="assets/resume-pro.css"><style>body{margin:0;background:#fff}.op-page{box-shadow:none!important;margin:0!important}</style><div id=c></div><script type=module>import{renderResume}from"./resume/render.js";const d=await(await fetch("assets/sample-pro.json")).json();const pg=renderResume(d,document.getElementById("c"),{highlightLabels:false});pg.classList.add("pro");await document.fonts.ready;window.done=1;</script>`); }
  const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(s);
}).listen(0);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const pg = await b.newPage({ deviceScaleFactor: 2.2 });
await pg.goto(`http://localhost:${srv.address().port}/__tex.html`);
await pg.waitForFunction(() => window.done);
console.log(await pg.evaluate(() => { const r = document.querySelector('.op-page').getBoundingClientRect(); const t = document.querySelector('.op-table').getBoundingClientRect(); const v = (sel) => { const e = document.querySelectorAll('.op-bullet,.op-summary')[sel]; const b = e.getBoundingClientRect(); return +((b.top + b.height / 2 - r.top) / r.height).toFixed(3); }; const wraps = [...document.querySelectorAll('.op-bullet')].filter((b) => b.getClientRects().length > 1 || b.getBoundingClientRect().height > parseFloat(getComputedStyle(b).lineHeight) * 1.5).map((b) => b.textContent.slice(0, 40)); return { wraps, tableBottom: +((t.bottom - r.top) / r.height).toFixed(3), summary: v(0), exp2: v(2), proj: v(11) }; }));
await pg.locator('.op-page').screenshot({ path: 'web/assets/paper-resume.jpg', type: 'jpeg', quality: 80 });
await b.close(); srv.close();
console.log('saved', fs.statSync('web/assets/paper-resume.jpg').size);
