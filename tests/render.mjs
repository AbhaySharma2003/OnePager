// Usage: node tests/render.mjs <fixture.json> <out-basename>
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve('.');
const types = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.ttf':'font/ttf' };
const srv = http.createServer((q, s) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(p)) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(s); }).listen(0);
const port = srv.address().port;
const [fx, out] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(()=>chromium.launch());
const pg = await b.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 2 });
pg.on('console', m => console.log('console:', m.text()));
await pg.goto(`http://localhost:${port}/tests/render.html?f=/${fx}`);
await pg.waitForFunction('window.__done === true', null, { timeout: 15000 });
const fit = await pg.evaluate(() => ({ ...window.__fit, bullets: window.__fit.bullets.map(b => ({ lines: b.lines, fill: b.fill, text: b.text })) }));
fs.writeFileSync(out + '.fit.json', JSON.stringify(fit, null, 1));
await pg.pdf({ path: out + '.pdf', format: 'A4', printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
await pg.locator('.op-page').screenshot({ path: out + '.png' });
console.log(JSON.stringify({ fits: fit.fits, usedPt: fit.usedPt, overflowPt: fit.overflowPt, freeLines: fit.freeLines, problems: fit.problems.length }));
await b.close(); srv.close();
