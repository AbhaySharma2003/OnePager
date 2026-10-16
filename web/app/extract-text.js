// Turns an uploaded CV (PDF, DOCX, XLSX/CSV, TXT) into plain text in the browser.
// Nothing is uploaded at this step; only the extracted text goes to the AI.

const load = (src) => new Promise((res, rej) => {
  if (document.querySelector(`script[src="${src}"]`)) return res();
  const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Could not load reader library")); document.head.appendChild(s);
});

async function pdfText(buf) {
  const pdfjs = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const pages = [];
  for (let i = 1; i <= Math.min(doc.numPages, 6); i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    // Rebuild lines from y positions so tables/columns stay readable.
    const rows = new Map();
    for (const it of tc.items) {
      if (!it.str?.trim()) continue;
      const y = Math.round(it.transform[5]);
      const key = [...rows.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push({ x: it.transform[4], s: it.str });
    }
    const lines = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, parts]) => parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(" ").replace(/\s+/g, " ").trim());
    pages.push(lines.join("\n"));
  }
  return pages.join("\n\n");
}

async function docxText(buf) {
  await load("https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js");
  const r = await window.mammoth.extractRawText({ arrayBuffer: buf });
  return r.value;
}

async function sheetText(buf) {
  await load("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js");
  const wb = window.XLSX.read(buf, { type: "array" });
  // Read the Master CV sheet first if present; skip guideline/sample sheets.
  const names = wb.SheetNames.filter((n) => !/guideline|sample reference|sop|cheat|checklist/i.test(n));
  return names.map((n) => {
    const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: "" });
    return `### ${n}\n` + rows.map((r) => r.map((c) => String(c).trim()).filter(Boolean).join(" | ")).filter(Boolean).join("\n");
  }).join("\n\n");
}

export async function fileToText(file) {
  if (file.size > 8 * 1024 * 1024) throw new Error("File is larger than 8 MB.");
  const buf = await file.arrayBuffer();
  const name = file.name.toLowerCase();
  let text;
  if (name.endsWith(".pdf")) text = await pdfText(buf);
  else if (name.endsWith(".docx")) text = await docxText(buf);
  else if (/\.(xlsx|xls|csv)$/.test(name)) text = await sheetText(buf);
  else if (/\.(txt|md)$/.test(name)) text = new TextDecoder().decode(buf);
  else throw new Error("Upload a PDF, Word (.docx) or Excel file.");
  text = text.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").trim();
  if (text.length < 80) throw new Error("We couldn't read text from this file. If it's a scanned image, upload the Word/PDF original or fill the form instead.");
  return text;
}
