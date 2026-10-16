// Screenshot pages of web/ at desktop + mobile. Usage: node shot.mjs <path> <outprefix>
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve('web');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf' };
const srv = http.createServer((q, s) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0].split('#')[0])); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(s); }).listen(0);
const port = srv.address().port;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const [name, vp] of [['desk', { width: 1440, height: 900 }], ['mob', { width: 390, height: 844 }]]) {
  const pg = await (await b.newContext({ viewport: vp, deviceScaleFactor: 1 })).newPage();
  const errors = []; pg.on('pageerror', (e) => errors.push(e.message)); pg.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await pg.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: fs.existsSync('/tmp/geist.css') ? fs.readFileSync('/tmp/geist.css','utf8') : '' }));
  await pg.route('https://cdn.jsdelivr.net/npm/@supabase/**', (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync('tests/stubs/supabase-stub.js', 'utf8') }));
  await pg.goto(`http://localhost:${port}/${process.argv[2]}`); await pg.waitForTimeout(800);
  await pg.screenshot({ path: `tests/out/${process.argv[3]}-${name}.png`, fullPage: true });
  const sw = await pg.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  console.log(name, 'overflow', sw, errors);
}
await b.close(); srv.close();
