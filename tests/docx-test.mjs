// node tests/docx-test.mjs <fixture.json> <out.docx>
import fs from 'node:fs';
import JSZip from 'jszip';
globalThis.JSZip = JSZip;
const { buildDocxBlob } = await import('../web/resume/export-docx.js');
const [fx, out] = process.argv.slice(2);
const blob = await buildDocxBlob(JSON.parse(fs.readFileSync(fx, 'utf8')));
fs.writeFileSync(out, Buffer.from(await blob.arrayBuffer()));
console.log('wrote', out, fs.statSync(out).size, 'bytes');
