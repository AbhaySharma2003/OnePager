// Paywall + payment smoke test with stubbed Supabase, CDNs and a fake Dodo checkout page.
// 1) signed out -> email code sign-in  2) first one-pager FREE -> downloads
// 3) second one-pager LOCKED: blurred, scrambled, pay button  4) pay -> return -> unlocked -> download
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve('web');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf' };
const fakeDodo = `<!doctype html><meta charset=utf-8><title>Dodo test checkout</title><body style="font:16px sans-serif;padding:40px">
<h2>Dodo Payments (test)</h2><p>OnePager one-pager · ₹49</p><button id="paynow">Pay ₹49</button>
<script>
const u = new URL(location.href); const ret = new URL(u.searchParams.get('return'));
document.getElementById('paynow').onclick = () => {
  const db = JSON.parse(sessionStorage.getItem('__stub_db')); const pid = 'pay_test_' + Date.now(); db.paid.push(pid);
  sessionStorage.setItem('__stub_db', JSON.stringify(db));
  ret.searchParams.set('payment_id', pid); ret.searchParams.set('status', 'succeeded'); location.href = ret.toString();
};
</script>`;
const srv = http.createServer((q, s) => {
  if (q.url.startsWith('/__dodo')) { s.writeHead(200, { 'content-type': 'text/html' }); return s.end(fakeDodo); }
  const p = path.join(root, decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(s);
}).listen(0);
const port = srv.address().port;
const resume = JSON.parse(fs.readFileSync('tests/fixtures/template_replica.json')); delete resume.header;
const master = { personal: { name: 'John Doe', email: 'john.doe@example.com', phone: '+91 9999999999', linkedin: 'https://www.linkedin.com/in/john-doe/' }, education: [{ degree: 'MBA in Product Management', institute: "Northfield School of Business", start_year: '2025', end_year: 'Present' }] };
const fixtures = { extract: { master }, generate: { resume, flags: [] }, refine: { resume } };
const libs = {
  'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js': 'node_modules/pdf-lib/dist/pdf-lib.min.js',
  'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js': 'node_modules/@pdf-lib/fontkit/dist/fontkit.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js': 'node_modules/jszip/dist/jszip.min.js',
};
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
const pg = await ctx.newPage();
const errors = [], log = {};
pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
pg.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await pg.route('https://cdn.jsdelivr.net/npm/@supabase/**', (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync('tests/stubs/supabase-stub.js', 'utf8') }));
for (const [u, f] of Object.entries(libs)) await pg.route(u, (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(f, 'utf8') }));
await pg.route('**/config.js', async (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync('web/config.js', 'utf8').replace('PAYMENTS_LIVE = false', 'PAYMENTS_LIVE = true') }));
await pg.route('**/functions/v1/status', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ payments_live: true, price_label: '$0.90' }) }));
await pg.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
await pg.addInitScript(([f]) => { window.__FIXTURES__ = f; window.__STUB__ = { signedOut: true }; }, [fixtures]);
const out = 'tests/out/';
const settle = async () => { await pg.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 30000 }); await pg.waitForTimeout(300); };
const cvFile = { name: 'cv.txt', mimeType: 'text/plain', buffer: Buffer.from('John Doe\nNorthfield School of Business MBA 2025-Present\nProduct intern at XYZ, built dashboards used by 40 managers, cut reporting time by 30 percent.\n'.repeat(2)) };

// Landing page
await pg.goto(`http://localhost:${port}/index.html`);
await pg.screenshot({ path: out + 'p-0-landing.png' });
await pg.locator('#pricing').screenshot({ path: out + 'p-0-pricing.png' });
log.landingFree = await pg.locator('.price-note[data-pay="live"]').innerText();

// 1) signed out: upload -> sign in with code
await pg.goto(`http://localhost:${port}/app.html`);
await pg.waitForSelector('#v-start:not([hidden])');
log.offer1 = await pg.locator('#offer').innerText();
await pg.setInputFiles('#file-cv', cvFile);
await pg.waitForSelector('#auth:not([hidden])');
await pg.fill('#email', 'ratelimit@example.com'); await pg.click('#send-link');
await pg.waitForTimeout(300); log.rateLimitMsg = await pg.locator('#auth-msg').innerText();
await pg.fill('#email', 'student@example.com');
await pg.evaluate(() => (document.querySelector('#send-link').disabled = false));
await pg.click('#send-link');
await pg.waitForSelector('#code-step:not([hidden])');
await pg.fill('#code', '111111'); await pg.click('#verify-code'); await pg.waitForTimeout(200);
log.badCodeMsg = await pg.locator('#auth-msg').innerText();
await pg.screenshot({ path: out + 'p-1-signin-code.png' });
await pg.fill('#code', '123456'); await pg.click('#verify-code');

// 2) first one-pager is free
await pg.waitForSelector('#v-resume:not([hidden])', { timeout: 20000 }); await settle();
log.first = await pg.evaluate(() => ({ paywall: !document.querySelector('#paywall').hidden, pdfBtn: !document.querySelector('#dl-pdf').hidden, text: document.querySelector('#paper').innerText.slice(0, 60) }));
const [d1] = await Promise.all([pg.waitForEvent('download'), pg.click('#dl-pdf')]);
log.firstDownload = d1.suggestedFilename();

// 3) second one-pager: locked
await pg.goto(`http://localhost:${port}/app.html`);
await pg.waitForSelector('#v-start:not([hidden])'); await pg.waitForTimeout(400);
log.offer2 = await pg.locator('#offer').innerText();
await pg.screenshot({ path: out + 'p-2-start-after-free.png' });
await pg.click('.domain-chip[data-domain="Product Management"]');
await pg.setInputFiles('#file-cv', cvFile);
await pg.waitForSelector('#paynote:not([hidden])', { timeout: 10000 });
log.paidNotice = await pg.locator('#paynote .dialog').innerText();
await pg.screenshot({ path: out + 'p-2b-paid-notice.png' });
await pg.click('#pn-go');
await pg.waitForSelector('#v-resume:not([hidden])', { timeout: 20000 }); await settle();
log.second = await pg.evaluate(() => ({
  paywall: !document.querySelector('#paywall').hidden, blurred: getComputedStyle(document.querySelector('.paper-scale')).filter,
  pdfBtn: !document.querySelector('#dl-pdf').hidden, payTop: !document.querySelector('#pay-top').hidden,
  hasRealWords: /NORTHFIELD|SCHOOL|Product/.test(document.querySelector('#paper .op-body, #paper').innerText.replace(/john|doe/ig, '')),
  card: document.querySelector('.paywall-card').innerText,
}));
await pg.screenshot({ path: out + 'p-3-locked.png' });
log.callsBeforePay = await pg.evaluate(() => window.__calls);

// 4) pay -> fake Dodo -> return -> unlocked
await pg.click('#pay');
await pg.waitForURL(/__dodo/);
await pg.screenshot({ path: out + 'p-4-dodo.png' });
await pg.click('#paynow');
await pg.waitForURL(/app\.html/);
await pg.waitForSelector('#v-resume:not([hidden])', { timeout: 20000 }); await settle();
log.afterPay = await pg.evaluate(() => ({ url: location.href.replace(location.origin, ''), paywall: !document.querySelector('#paywall').hidden, pdfBtn: !document.querySelector('#dl-pdf').hidden, real: /NORTHFIELD|ZZZZ|SCHOOL|INSTITUTE|UNIVERSITY/.test(document.querySelector('#paper').innerText), calls: window.__calls }));
await pg.screenshot({ path: out + 'p-5-unlocked.png' });
const [d2] = await Promise.all([pg.waitForEvent('download'), pg.click('#dl-docx')]);
log.paidDownload = d2.suggestedFilename();
// saved list shows statuses
await pg.goto(`http://localhost:${port}/app.html`); await pg.waitForTimeout(500);
log.saved = await pg.locator('#saved-list').innerText();
await pg.screenshot({ path: out + 'p-6-saved.png' });
console.log(JSON.stringify({ log, errors }, null, 1));
await b.close(); srv.close();
