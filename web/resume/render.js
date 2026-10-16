// OnePager resume renderer + fit checker. No dependencies.
// renderResume(data, container) -> builds the A4 sheet from a one-pager JSON (data/onepager.schema.json)
// checkFit(pageEl) -> { fits, overflowPt, bullets:[{el,lines,fill}], problems:[...] }

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// **bold** markup -> <b>, everything else escaped. Normalises separators to " | ".
export function rich(text) {
  const t = esc(text).replace(/\s*\|\s*/g, " | ");
  return t.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

const has = (a) => Array.isArray(a) && a.length > 0;
const link = (href, label) => {
  if (!href) return "";
  const url = /^https?:\/\//i.test(href) || href.startsWith("mailto:") ? href : `https://${href}`;
  return `<a href="${esc(url)}">${esc(label ?? href)}</a>`;
};

function dateCell(dates, location) {
  return `<td class="op-date">${esc(dates || "")}${location ? `<span class="loc">${esc(location)}</span>` : ""}</td>`;
}

function bullets(list) {
  return (list || []).filter(Boolean).map((b) => `<span class="op-bullet" data-bullet>${rich(b)}</span>`).join("");
}

function entryBody(e) {
  let h = `<div class="op-org">${esc(e.org)}${e.org_description ? ` <span class="desc">(${esc(e.org_description)})</span>` : ""}</div>`;
  if (e.role) h += `<div class="op-role">${esc(e.role)}</div>`;
  for (const g of e.groups || []) {
    const heading = String(g.heading ?? "").replace(/[_*#]+/g, "").trim();
    if (heading) h += `<div class="op-sub">${esc(heading)}</div>`;
    h += bullets(g.bullets);
  }
  return h;
}

function section(label, rows) {
  // rows: [{ body: html, dates, location }]
  if (!rows.length) return "";
  return rows
    .map((r, i) => `<tr>${i === 0 ? `<td class="op-label" rowspan="${rows.length}"><span>${esc(label)}</span></td>` : ""}<td>${r.body}</td>${dateCell(r.dates, r.location)}</tr>`)
    .join("");
}

export function renderResume(d, container, opts = {}) {
  const h = d.header || {};
  const contact = [
    h.email ? link(`mailto:${h.email}`, h.email) : "",
    h.phone ? esc(h.phone) : "",
    h.linkedin ? link(h.linkedin) : "",
    h.portfolio ? link(h.portfolio) : "",
  ].filter(Boolean).join(" | ");

  let rows = "";
  if (d.summary) rows += section("Professional Summary", [{ body: `<div class="op-summary">${rich(d.summary)}</div>` }]);
  if (has(d.education))
    rows += section("Education", d.education.map((e) => ({
      body: `<div class="op-org">${esc(e.institution)}</div><div class="op-line">${rich(e.program)}</div>${(e.details || []).map((x) => `<div class="op-line">${rich(x)}</div>`).join("")}`,
      dates: e.dates, location: e.location,
    })));
  for (const [key, label] of [["experience", "Experience"], ["internships", "Internships"], ["projects", "Projects"]]) {
    if (has(d[key])) rows += section(label, d[key].map((e) => ({ body: entryBody(e), dates: e.dates, location: e.location })));
  }
  if (has(d.certifications))
    rows += section("Certifications", d.certifications.map((c) => ({
      body: `<div><b>${esc(c.name)}</b>${c.issuer ? ` | <i>${esc(c.issuer)}</i>` : ""}</div>${bullets(c.bullets)}`,
      dates: c.dates,
    })));
  if (has(d.achievements)) rows += section("Achievements", [{ body: bullets(d.achievements) }]);
  if (has(d.leadership))
    rows += section("Leadership", d.leadership.map((e) => ({ body: entryBody({ ...e, org: (e.org || "").toUpperCase() }), dates: e.dates, location: e.location })));
  if (has(d.extracurricular)) rows += section("Extra-curricular", [{ body: bullets(d.extracurricular) }]);
  if (has(d.social_impact)) rows += section("Social Impact", d.social_impact.map((e) => ({ body: entryBody(e), dates: e.dates, location: e.location })));
  const sk = d.skills || {};
  if (has(sk.business) || has(sk.technical)) {
    const lines = [];
    if (has(sk.business)) lines.push(`<div><b>Business Skills:</b> ${sk.business.map(esc).join(" | ")}</div>`);
    if (has(sk.technical)) lines.push(`<div><b>Technical Skills:</b> ${sk.technical.map(esc).join(" | ")}</div>`);
    rows += section("Skills", [{ body: lines.join("") }]);
  }

  const page = document.createElement("div");
  page.className = "op-page" + (opts.highlightLabels === false ? " no-highlight" : "");
  page.innerHTML = `
    <div class="op-head"><div class="op-name">${esc(h.name)}</div><div>${contact}</div></div>
    <table class="op-table"><colgroup><col class="c1"><col class="c2"><col class="c3"></colgroup><tbody>${rows}</tbody></table>`;
  container.replaceChildren(page);
  return page;
}

// Measures the rendered sheet. Bullets should fill exactly one line (SOP: "ideally complete one full line").
export function checkFit(page, { minFill = 0.72 } = {}) {
  page.querySelectorAll(".op-warn-overflow,.op-warn-short").forEach((el) => el.classList.remove("op-warn-overflow", "op-warn-short"));
  page.querySelectorAll(".op-overflow-line").forEach((el) => el.remove());

  const pt = page.getBoundingClientRect().height / 841.9; // px per pt at current zoom
  const lineH = 9.9 * pt;
  const table = page.querySelector(".op-table");
  const usedPt = (table.getBoundingClientRect().bottom - page.getBoundingClientRect().top) / pt;
  const limitPt = 841.9 - 14; // keep a small bottom margin
  const overflowPt = Math.max(0, usedPt - limitPt);

  const problems = [];
  const report = [];
  page.querySelectorAll("[data-bullet]").forEach((el) => {
    const rects = el.getClientRects();
    const lines = Math.round(el.getBoundingClientRect().height / lineH);
    const cellW = el.parentElement.getBoundingClientRect().width;
    const range = document.createRange();
    range.selectNodeContents(el);
    const lastRects = range.getClientRects();
    const last = lastRects[lastRects.length - 1];
    const fill = last ? (last.right - el.getBoundingClientRect().left) / cellW : 0;
    const item = { el, text: el.textContent, lines, fill: Math.round(fill * 100) / 100 };
    report.push(item);
    if (lines > 1) { el.classList.add("op-warn-overflow"); problems.push({ type: "wraps", text: item.text, lines }); }
    else if (fill < minFill) { el.classList.add("op-warn-short"); problems.push({ type: "short", text: item.text, fill: item.fill }); }
    void rects;
  });

  if (overflowPt > 0) {
    const line = document.createElement("div");
    line.className = "op-overflow-line";
    line.style.top = `${limitPt}pt`;
    page.appendChild(line);
    problems.unshift({ type: "page_overflow", overflowPt: Math.round(overflowPt), linesOver: Math.ceil(overflowPt / 9.9) });
  }
  return { fits: overflowPt === 0, usedPt: Math.round(usedPt), overflowPt: Math.round(overflowPt), freeLines: Math.floor((limitPt - usedPt) / 9.9), bullets: report, problems };
}
