// UI smoke test of web/app.html with stubbed Supabase/CDNs.
// Path A: form -> create -> resume -> download PDF + Word.  Path B: upload a CV -> resume.
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve('web');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf' };
const srv = http.createServer((q, s) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0].split('#')[0])); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(s); }).listen(0);
const port = srv.address().port;
const fx = process.argv[2] || 'tests/fixtures/template_replica.json';
const resume = JSON.parse(fs.readFileSync(fx)); delete resume.header;
const master = { personal: { name: 'John Doe', email: 'john.doe@example.com', phone: '+91 9999999999', linkedin: 'https://www.linkedin.com/in/john-doe/' }, education: [{ degree: 'MBA in Product Management', institute: "Northfield School of Business", start_year: '2025', end_year: 'Present' }] };
const fixtures = { extract: { master }, generate: { resume, flags: [], id: 'r1' }, refine: { resume } };
const libs = {
  'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js': 'node_modules/pdf-lib/dist/pdf-lib.min.js',
  'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js': 'node_modules/@pdf-lib/fontkit/dist/fontkit.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js': 'node_modules/jszip/dist/jszip.min.js',
};
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
pg.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await pg.route('https://cdn.jsdelivr.net/npm/@supabase/**', (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync('tests/stubs/supabase-stub.js', 'utf8') }));
for (const [u, f] of Object.entries(libs)) await pg.route(u, (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(f, 'utf8') }));
await pg.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
await pg.addInitScript((f) => { window.__FIXTURES__ = f; }, fixtures);
const out = 'tests/out/';
await pg.goto(`http://localhost:${port}/app.html`);
await pg.waitForSelector('#v-start:not([hidden])');
await pg.click('.domain-chip[data-domain="Product Management"]');
await pg.fill('#role', 'Associate Product Manager');
await pg.screenshot({ path: out + 'v2-1-start.png' });
// Path A: form
await pg.click('#go-form');
await pg.waitForSelector('#v-master:not([hidden])');
for (const [k, v] of Object.entries(master.personal)) await pg.fill(`#f-personal-${k}`, v);
await pg.click('[data-add="education"]');
await pg.fill('#f-education-0-degree', 'MBA in Product Management');
await pg.fill('#f-education-0-institute', "Northfield School of Business");
await pg.screenshot({ path: out + 'v2-2-master.png' });
await pg.click('#create');
await pg.waitForSelector('#v-resume:not([hidden])', { timeout: 20000 });
await pg.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 30000 });
await pg.waitForTimeout(400);
await pg.screenshot({ path: out + 'v2-3-resume.png' });
const [pdf] = await Promise.all([pg.waitForEvent('download'), pg.click('#dl-pdf')]);
await pdf.saveAs(out + 'v2-download.pdf');
const [docx] = await Promise.all([pg.waitForEvent('download'), pg.click('#dl-docx')]);
await docx.saveAs(out + 'v2-download.docx');
// Path B: upload
await pg.goto(`http://localhost:${port}/app.html`);
await pg.waitForSelector('#v-start:not([hidden])');
await pg.setInputFiles('#file-cv', { name: 'cv.txt', mimeType: 'text/plain', buffer: Buffer.from('John Doe\nNorthfield School of Business MBA 2025-Present\nProduct intern at XYZ, built dashboards used by 40 managers, cut reporting time by 30 percent.\n'.repeat(2)) });
await pg.waitForSelector('#v-resume:not([hidden])', { timeout: 20000 });
await pg.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 30000 });
console.log(JSON.stringify({ calls: await pg.evaluate(() => window.__calls), errors, pdf: fs.statSync(out + 'v2-download.pdf').size, docx: fs.statSync(out + 'v2-download.docx').size }, null, 1));
await b.close(); srv.close();
