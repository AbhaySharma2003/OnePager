// Screenshots of the home-page paper story at several scroll points (desktop + phone).
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve('web');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.ttf': 'font/ttf' };
const srv = http.createServer((q, s) => {
  const p = path.join(root, decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(s);
}).listen(0);
const port = srv.address().port;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const only = process.argv[2];
const sizes = { desk: { width: 1440, height: 900 }, phone: { width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 } };
const errors = [];
for (const [name, vp] of Object.entries(sizes)) {
  if (only && only !== name) continue;
  const pg = await b.newPage({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, deviceScaleFactor: vp.deviceScaleFactor || 1 });
  pg.on('pageerror', (e) => errors.push(name + ' pageerror: ' + e.message));
  pg.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(name + ' console: ' + m.text()); });
  await pg.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: fs.readFileSync('tests/stubs/carlito.css', 'utf8').replaceAll('url("/', `url("http://localhost:${port}/`) }));
  await pg.goto(`http://localhost:${port}/index.html`);
  await pg.waitForTimeout(2500);
  for (const p of (process.argv[3] || '0,0.15,0.3,0.45,0.6,0.8,1').split(',').map(Number)) {
    await pg.evaluate((p) => { const s = document.getElementById('story'); scrollTo(0, s.offsetTop + p * (s.offsetHeight - innerHeight)); }, p);
    await pg.waitForTimeout(+process.env.WAIT || 1800);
    await pg.screenshot({ path: `tests/out/story-${name}-${p}.png` });
  }
  await pg.evaluate(() => document.querySelector('#faq details').open = true);
  await pg.locator('.doc').screenshot({ path: `tests/out/story-${name}-doc.png` });
  const st = await pg.evaluate(() => document.getElementById('story').className);
  console.log(name, 'story class:', st);
}
console.log(JSON.stringify(errors, null, 1));
await b.close(); srv.close();
