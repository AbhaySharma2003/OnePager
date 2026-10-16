// Word (.docx) export of a one-pager JSON in the one-page template.
// Same geometry as the PDF: A4, 3-column bordered table (58 / 460 / 61 pt), Calibri 9pt, exact 9.9pt lines,
// merged + yellow-highlighted section labels, bold-italic underlined sub-skills, blue clickable links.
// Built directly as Office Open XML and zipped with JSZip (no server needed).

const JSZIP = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
const load = (src) => new Promise((res, rej) => {
  if (typeof window === "undefined" || window.JSZip) return res();
  const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Could not load the Word library. Check your connection.")); document.head.appendChild(s);
});

const x = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const PT = 20; // twips per point
const COLS = [58 * PT, 460 * PT, 61 * PT];

function run(text, o = {}) {
  const rp = [
    o.font ? `<w:rFonts w:ascii="${o.font}" w:hAnsi="${o.font}" w:cs="${o.font}"/>` : "",
    o.b ? "<w:b/><w:bCs/>" : "", o.i ? "<w:i/><w:iCs/>" : "",
    o.color ? `<w:color w:val="${o.color}"/>` : "",
    o.size ? `<w:sz w:val="${o.size}"/><w:szCs w:val="${o.size}"/>` : "",
    o.hl ? `<w:highlight w:val="yellow"/>` : "", o.u ? `<w:u w:val="single"/>` : "",
  ].join("");
  return `<w:r>${rp ? `<w:rPr>${rp}</w:rPr>` : ""}<w:t xml:space="preserve">${x(text)}</w:t></w:r>`;
}
// **bold** markup + " | " separators, on top of a base style
function rich(text, base = {}) {
  const t = String(text ?? "").replace(/\s*\|\s*/g, " | ");
  return t.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((seg) =>
    seg.startsWith("**") ? run(seg.slice(2, -2), { ...base, b: true }) : run(seg, base)).join("");
}
function para(inner, o = {}) {
  const pp = `<w:pPr>${o.keep ? "<w:keepNext/>" : ""}<w:spacing w:before="0" w:after="${o.after ?? 0}" w:line="198" w:lineRule="exact"/>${o.center ? '<w:jc w:val="center"/>' : ""}</w:pPr>`;
  return `<w:p>${pp}${inner}</w:p>`;
}
const bulletP = (text) => para(run("● ", { font: "Arial", size: 17 }) + rich(text));

function cell(width, paras, o = {}) {
  const vm = o.vMerge === "restart" ? '<w:vMerge w:val="restart"/>' : o.vMerge === "continue" ? "<w:vMerge/>" : "";
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${vm}</w:tcPr>${paras.length ? paras.join("") : para("")}</w:tc>`;
}

function entryParas(e) {
  const out = [para(run(e.org ?? "", { b: true }) + (e.org_description ? run(" (" + e.org_description + ")", { i: true }) : ""))];
  if (e.role) out.push(para(run(e.role, { b: true })));
  for (const g of e.groups || []) {
    const h = String(g.heading ?? "").replace(/[_*#]+/g, "").trim();
    if (h) out.push(para(run(h, { b: true, i: true, u: true })));
    for (const b of g.bullets || []) if (b) out.push(bulletP(b));
  }
  return out;
}
const dateParas = (dates, location) => [para(run(dates || "")), ...(location ? [para(run(location, { b: true }))] : [])];

export function buildDocumentXml(d, links) {
  const h = d.header || {};
  const has = (a) => Array.isArray(a) && a.length > 0;
  const rows = [];
  const section = (label, items) => {
    items.forEach((it, i) => {
      const lab = i === 0 ? [para(run(label, { b: true, hl: true }))] : [];
      rows.push(`<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(COLS[0], lab, { vMerge: items.length > 1 ? (i === 0 ? "restart" : "continue") : null })}${cell(COLS[1], it.body)}${cell(COLS[2], it.date || [])}</w:tr>`);
    });
  };
  if (d.summary) section("Professional Summary", [{ body: [para(rich(d.summary, { i: true }))] }]);
  if (has(d.education)) section("Education", d.education.map((e) => ({
    body: [para(run(e.institution, { b: true })), para(rich(e.program)), ...(e.details || []).map((t) => para(rich(t)))],
    date: dateParas(e.dates, e.location),
  })));
  for (const [k, label] of [["experience", "Experience"], ["internships", "Internships"], ["projects", "Projects"]])
    if (has(d[k])) section(label, d[k].map((e) => ({ body: entryParas(e), date: dateParas(e.dates, e.location) })));
  if (has(d.certifications)) section("Certifications", d.certifications.map((c) => ({
    body: [para(run(c.name, { b: true }) + (c.issuer ? run(" | ") + run(c.issuer, { i: true }) : "")), ...(c.bullets || []).map(bulletP)],
    date: dateParas(c.dates),
  })));
  if (has(d.achievements)) section("Achievements", [{ body: d.achievements.map(bulletP) }]);
  if (has(d.leadership)) section("Leadership", d.leadership.map((e) => ({ body: entryParas({ ...e, org: String(e.org || "").toUpperCase() }), date: dateParas(e.dates, e.location) })));
  if (has(d.extracurricular)) section("Extra-curricular", [{ body: d.extracurricular.map(bulletP) }]);
  if (has(d.social_impact)) section("Social Impact", d.social_impact.map((e) => ({ body: entryParas(e), date: dateParas(e.dates, e.location) })));
  const sk = d.skills || {};
  if (has(sk.business) || has(sk.technical)) section("Skills", [{ body: [
    ...(has(sk.business) ? [para(run("Business Skills: ", { b: true }) + run(sk.business.join(" | ")))] : []),
    ...(has(sk.technical) ? [para(run("Technical Skills: ", { b: true }) + run(sk.technical.join(" | ")))] : []),
  ] }]);

  // Header: name + contact line with real hyperlinks
  const linkRun = (url, label) => {
    const id = `rIdL${links.length + 1}`; links.push({ id, url });
    return `<w:hyperlink r:id="${id}" w:history="1">${run(label, { color: "1155CC", u: true })}</w:hyperlink>`;
  };
  const parts = [];
  if (h.email) parts.push(linkRun(`mailto:${h.email}`, h.email));
  if (h.phone) parts.push(run(h.phone));
  for (const u of [h.linkedin, h.portfolio]) if (u) parts.push(linkRun(/^https?:\/\//i.test(u) ? u : `https://${u}`, u));
  const contact = parts.join(run(" | "));

  const border = (s) => `<w:${s} w:val="single" w:sz="8" w:space="0" w:color="000000"/>`;
  const table = `<w:tbl><w:tblPr><w:tblW w:w="${COLS[0] + COLS[1] + COLS[2]}" w:type="dxa"/><w:tblLayout w:type="fixed"/>
<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders>
<w:tblCellMar><w:top w:w="48" w:type="dxa"/><w:left w:w="32" w:type="dxa"/><w:bottom w:w="58" w:type="dxa"/><w:right w:w="28" w:type="dxa"/></w:tblCellMar></w:tblPr>
<w:tblGrid>${COLS.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${rows.join("")}</w:tbl>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>
${para(run(String(h.name || "").toUpperCase(), { b: true }), { center: true })}
${para(contact, { center: true, after: 200 })}
${table}
${para("")}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="330" w:right="300" w:bottom="280" w:left="290" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="18"/><w:szCs w:val="18"/><w:lang w:val="en-IN"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="198" w:lineRule="exact"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="1155CC"/><w:u w:val="single"/></w:rPr></w:style>
</w:styles>`;

export async function buildDocxBlob(resume, title = "One Page Resume") {
  await load(JSZIP);
  const JSZip = globalThis.JSZip;
  const links = [];
  const docXml = buildDocumentXml(resume, links);
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${links.map((l) => `<Relationship Id="${l.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${x(l.url)}" TargetMode="External"/>`).join("")}</Relationships>`);
  zip.file("word/styles.xml", STYLES);
  zip.file("word/document.xml", docXml);
  zip.file("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(title)}</dc:title><dc:creator>OnePager</dc:creator></cp:coreProperties>`);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}
