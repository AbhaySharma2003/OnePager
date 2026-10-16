// Direct PDF download of the rendered one-pager. Traces the on-screen template word by word into a
// vector A4 PDF with the embedded Calibri-metric font (Carlito): selectable text, exact layout,
// 1pt grid, yellow section labels and clickable email/LinkedIn links.

const LIBS = {
  pdflib: "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js",
  fontkit: "https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js",
};
const load = (src) => new Promise((res, rej) => {
  if (document.querySelector(`script[src="${src}"]`)) return res();
  const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Could not load the PDF library. Check your connection.")); document.head.appendChild(s);
});
const fontUrl = (name) => new URL(`./fonts/pdf/Carlito-${name}.ttf`, import.meta.url).href; // pre-subset copies
const ASC = 1950, DESC = 550; // Carlito/Calibri hhea metrics (2048 upm), same as the browser uses

export async function buildPdfBytes(page) {
  await load(LIBS.pdflib); await load(LIBS.fontkit);
  const { PDFDocument, rgb, PDFName, PDFString, pushGraphicsState, popGraphicsState, setCharacterSpacing } = window.PDFLib;
  const doc = await PDFDocument.create();
  doc.registerFontkit(window.fontkit);
  const bytes = async (n) => new Uint8Array(await (await fetch(fontUrl(n))).arrayBuffer());
  const [R, B, I, BI] = await Promise.all(["Regular", "Bold", "Italic", "BoldItalic"].map(async (n) => doc.embedFont(await bytes(n), { subset: false })));
  const W = 595.3, H = 841.9;
  const pdfPage = doc.addPage([W, H]);
  const box = page.getBoundingClientRect();
  const s = box.width / W; // css px per pt (works inside a scaled preview too)
  const X = (px) => (px - box.left) / s, Y = (px) => H - (px - box.top) / s;

  // 1) label highlights
  for (const span of page.querySelectorAll(".op-label span")) {
    const bg = getComputedStyle(span).backgroundColor;
    if (!bg || bg === "rgba(0, 0, 0, 0)" || bg === "transparent") continue;
    for (const r of span.getClientRects()) pdfPage.drawRectangle({ x: X(r.left), y: Y(r.bottom), width: r.width / s, height: r.height / s, color: rgb(1, 1, 0) });
  }
  // 2) grid
  const line = (x1, y1, x2, y2) => pdfPage.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 1, color: rgb(0, 0, 0) });
  for (const td of page.querySelectorAll(".op-table td")) {
    const r = td.getBoundingClientRect();
    const l = X(r.left), t = Y(r.top), rr = X(r.right), b = Y(r.bottom);
    line(l, t, rr, t); line(l, b, rr, b); line(l, t, l, b); line(rr, t, rr, b);
  }
  // 3) text, word by word, in the font/style the browser used
  const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement; if (!el || !n.nodeValue.trim()) continue;
    const cs = getComputedStyle(el);
    const bold = parseInt(cs.fontWeight, 10) >= 600, italic = cs.fontStyle === "italic";
    const font = bold && italic ? BI : bold ? B : italic ? I : R;
    const size = parseFloat(cs.fontSize) / s;
    const m = cs.color.match(/\d+(\.\d+)?/g)?.map(Number) || [0, 0, 0];
    const color = rgb(m[0] / 255, m[1] / 255, m[2] / 255);
    const underline = !!el.closest(".op-sub, a");
    const upper = cs.textTransform === "uppercase";
    const val = n.nodeValue;
    // Split each word into pieces that sit on one line (a hyphenated word can break across lines).
    const pieces = [];
    for (const w of val.matchAll(/\S+/g)) {
      const end = w.index + w[0].length;
      range.setStart(n, w.index); range.setEnd(n, end);
      if (range.getClientRects().length <= 1) { pieces.push([w.index, end]); continue; }
      let start = w.index, top = null;
      for (let i = w.index; i < end; i++) {
        range.setStart(n, i); range.setEnd(n, i + 1);
        const t = range.getClientRects()[0]?.top;
        if (top !== null && t !== undefined && Math.abs(t - top) > 1) { pieces.push([start, i]); start = i; }
        if (t !== undefined) top = t;
      }
      pieces.push([start, end]);
    }
    for (const [a, end] of pieces) {
      range.setStart(n, a); range.setEnd(n, end);
      const r = range.getClientRects()[0]; if (!r || !r.width) continue;
      const base = r.top + r.height * (ASC / (ASC + DESC));
      // Include the following space (when on the same line) so copy/paste and ATS parsers see separate words.
      let text = upper ? val.slice(a, end).toUpperCase() : val.slice(a, end), targetW = r.width;
      if (/\s/.test(val[end] ?? "")) {
        range.setStart(n, end); range.setEnd(n, end + 1);
        const sp = range.getClientRects()[0];
        if (sp && Math.abs(sp.top - r.top) < 1 && sp.width > 0) { text += " "; targetW = sp.right - r.left; }
      }
      // Fit the PDF text to the browser's measured width.
      const natural = font.widthOfTextAtSize(text, size);
      const tc = text.length > 1 ? (targetW / s - natural) / (text.length - 1) : 0;
      pdfPage.pushOperators(pushGraphicsState(), setCharacterSpacing(tc));
      pdfPage.drawText(text, { x: X(r.left), y: Y(base), size, font, color });
      pdfPage.pushOperators(popGraphicsState());
      if (underline) pdfPage.drawLine({ start: { x: X(r.left), y: Y(base) - 1 }, end: { x: X(r.left) + targetW / s, y: Y(base) - 1 }, thickness: 0.5, color });
    }
  }
  // 4) bullets (CSS ::before, so not in the DOM text)
  for (const b of page.querySelectorAll("[data-bullet]")) {
    const first = b.firstChild && document.createRange();
    if (!first) continue;
    first.selectNodeContents(b); const rects = first.getClientRects(); if (!rects.length) continue;
    const lineTop = rects[0].top, lineH = rects[0].height;
    const left = b.getBoundingClientRect().left;
    pdfPage.drawText("●", { x: X(left), y: Y(lineTop + lineH * (ASC / (ASC + DESC))), size: 8.4 * 0.86, font: R, color: rgb(0, 0, 0) });
  }
  // 5) clickable links
  const annots = [];
  for (const a of page.querySelectorAll("a[href]")) {
    const r = a.getBoundingClientRect();
    annots.push(doc.context.register(doc.context.obj({
      Type: "Annot", Subtype: "Link", Rect: [X(r.left), Y(r.bottom), X(r.right), Y(r.top)], Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(a.href) },
    })));
  }
  if (annots.length) pdfPage.node.set(PDFName.of("Annots"), doc.context.obj(annots));
  doc.setTitle(page.querySelector(".op-name")?.textContent?.trim() + " – One Page Resume");
  doc.setProducer("OnePager"); doc.setCreator("OnePager");
  return doc.save();
}

export function saveBlob(data, filename, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function downloadPdf(page, filename) {
  saveBlob(await buildPdfBytes(page), filename, "application/pdf");
}
