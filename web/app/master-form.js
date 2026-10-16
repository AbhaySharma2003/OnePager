// Master CV editor. Mirrors the "Master CV template" sheet section by section, with the guideline
// for each section shown as help text. Lists are edited one item per line.

const lines = { kind: "lines" };    // array of strings, one per line
const comma = { kind: "comma" };    // array of strings, comma separated
const text = { kind: "text" };
const area = { kind: "area" };

export const SECTIONS = [
  { key: "personal", title: "Personal details", single: true, fields: [
    ["name", "Full name", text], ["email", "Email ID", text], ["phone", "Phone", text],
    ["linkedin", "LinkedIn URL (full)", text], ["portfolio", "Portfolio URL (optional)", text], ["location", "City", text]] },
  { key: "education", title: "Education", hint: "Latest first. Include your score as written (8.6/10 or 92%). OnePager shows it only if it is above 80%.", item: "Degree", fields: [
    ["degree", "Degree / Class", text], ["specialisation", "Specialisation", text], ["institute", "Institute / School", text], ["board_university", "Board / University", text],
    ["start_year", "From (year)", text], ["end_year", "To (year or Present)", text], ["score", "% or CGPA", text], ["location", "City", text], ["highlights", "Highlights (one per line)", lines]] },
  { key: "work_experience", title: "Work experience", hint: "Position | Company | Tenure. Record everything: impact and business results, responsibilities, process improvements, stakeholders, recognition, tools, people mentored.", item: "Role", fields: "role" },
  { key: "internships", title: "Internships", hint: "Recognition and key takeaways, contributions, process improvements or new ideas, client/team exposure, LOR/LOA.", item: "Internship", fields: "role" },
  { key: "academic_projects", title: "Academic / live projects", hint: "Project name, your role, dates, what you did and the measurable outcome.", item: "Project", fields: [
    ["title", "Project title", text], ["subject", "Subject / area", text], ["role", "Your role", text], ["start", "From (Mon YYYY)", text], ["end", "To", text],
    ["description", "What you did", area], ["outcome", "Outcome / impact", area]] },
  { key: "freelance_projects", title: "Freelance projects", hint: "e.g. digital marketing, content, design. Key contributions and impact.", item: "Freelance project", fields: [
    ["name_role", "Project name / role", text], ["client", "Client", text], ["start", "From", text], ["end", "To", text], ["contributions", "Key contributions", area], ["impact", "Impact / outcome", area]] },
  { key: "research", title: "Research & publications", item: "Paper / thesis", fields: [
    ["title", "Title", text], ["focus_area", "Focus area", text], ["methodology", "Methodology", text], ["findings", "Key findings / impact", area], ["institution", "Institution", text], ["year", "Year", text]] },
  { key: "positions_of_responsibility", title: "Positions of responsibility", hint: "Student council, fests, clubs, NGO, captaincy, class rep, workplace leadership. Quantify footfall, revenue, sponsorship (partner + amount), team size, timeframe.", item: "Position", fields: [
    ["position", "Position", text], ["organisation", "Club / society / organisation", text], ["start", "From", text], ["end", "To", text],
    ["responsibilities", "Responsibilities", area], ["achievements", "Achievements (one per line)", lines]] },
  { key: "academic_achievements", title: "Academic achievements", hint: "Scholarships (amount, out of how many, by whom), ranks and medals, olympiads, CAT/GMAT/JEE scores, admits, PPOs. Always say out of how many.", item: "Achievement", fields: [["text", "Achievement", area], ["year", "Year", text]] },
  { key: "certifications", title: "Certifications", hint: "Full name, issuing organisation, year, score or percentile, level (e.g. CFA Level 1).", item: "Certification", fields: [
    ["name", "Certification name", text], ["issuer", "Issuing organisation", text], ["field", "Field", text], ["month", "Month", text], ["year", "Year", text], ["score", "Score / grade", text], ["status", "Completed or Ongoing", text]] },
  { key: "b_plan_competitions", title: "B-plan & case competitions", item: "Competition", fields: [
    ["competition", "Competition", text], ["conducted_by", "Conducted by", text], ["position", "Position / award", text], ["outcome", "Outcome", text], ["funding", "Funding (if any)", text], ["year", "Year", text]] },
  { key: "extra_curricular", title: "Extra-curricular", hint: "Sports, public speaking, creative, cultural, social work. Mention rank, out of how many, and level (state/national/international).", item: "Activity", fields: [
    ["activity", "Activity", text], ["category", "Category", { kind: "select", options: ["Social contribution", "Sports", "Public speaking", "Creative", "Cultural", "Miscellaneous"] }], ["achievements", "Achievements (one per line)", lines], ["year", "Year", text]] },
  { key: "skills", title: "Skills", single: true, fields: [["business", "Business skills (comma separated)", comma], ["technical", "Technical skills / tools (comma separated)", comma]] },
];
const ROLE_FIELDS = [
  ["designation", "Designation", text], ["company", "Company", text], ["company_description", "One-line company context (optional)", text], ["location", "City", text],
  ["start", "From (Mon YYYY)", text], ["end", "To (Mon YYYY or Present)", text], ["responsibilities", "Responsibilities (one per line)", lines], ["achievements", "Major achievements (one per line)", lines], ["tools", "Tools used (comma separated)", comma]];

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fieldsOf = (sec) => (sec.fields === "role" ? ROLE_FIELDS : sec.fields);
const toInput = (v, t) => (t.kind === "lines" ? (v || []).join("\n") : t.kind === "comma" ? (v || []).join(", ") : v ?? "");
const fromInput = (v, t) => (t.kind === "lines" ? v.split("\n").map((s) => s.trim()).filter(Boolean) : t.kind === "comma" ? v.split(",").map((s) => s.trim()).filter(Boolean) : v.trim());

function fieldHtml(id, label, t, value) {
  const v = esc(toInput(value, t));
  const wide = t.kind === "lines" || t.kind === "area" ? " wide" : "";
  let input;
  if (t.kind === "lines" || t.kind === "area") input = `<textarea id="${id}" rows="${t.kind === "lines" ? 4 : 3}">${v}</textarea>`;
  else if (t.kind === "select") input = `<select id="${id}"><option value=""></option>${t.options.map((o) => `<option${o === value ? " selected" : ""}>${o}</option>`).join("")}</select>`;
  else input = `<input id="${id}" value="${v}" autocomplete="off">`;
  return `<label class="fld${wide}" for="${id}"><span>${label}</span>${input}</label>`;
}

function itemSummary(sec, it) {
  const f = fieldsOf(sec);
  const first = it[f[0][0]], second = it[f[1]?.[0]];
  return esc([first, typeof second === "string" ? second : ""].filter(Boolean).join(" · ") || `New ${sec.item?.toLowerCase() ?? "item"}`);
}

export function renderMasterForm(root, master, onChange) {
  const m = structuredClone(master || {});
  const draw = () => {
    root.innerHTML = SECTIONS.map((sec) => {
      const count = sec.single ? "" : `<span class="count">${(m[sec.key] || []).length}</span>`;
      const hint = sec.hint ? `<p class="hint">${esc(sec.hint)}</p>` : "";
      let body;
      if (sec.single) {
        const obj = m[sec.key] || {};
        body = `<div class="grid">${fieldsOf(sec).map(([k, l, t]) => fieldHtml(`f-${sec.key}-${k}`, l, t, obj[k])).join("")}</div>`;
      } else {
        const items = m[sec.key] || [];
        body = items.map((it, i) => `
          <details class="item" ${it.__open ? "open" : ""} data-sec="${sec.key}" data-i="${i}">
            <summary><span>${itemSummary(sec, it)}</span><button type="button" class="link danger" data-del="${sec.key}:${i}">Remove</button></summary>
            <div class="grid">${fieldsOf(sec).map(([k, l, t]) => fieldHtml(`f-${sec.key}-${i}-${k}`, l, t, it[k])).join("")}</div>
          </details>`).join("") + `<button type="button" class="add" data-add="${sec.key}">+ Add ${esc((sec.item || "item").toLowerCase())}</button>`;
      }
      return `<section class="msec" id="sec-${sec.key}"><header><h3>${esc(sec.title)}</h3>${count}</header>${hint}${body}</section>`;
    }).join("");
  };
  const read = () => {
    for (const sec of SECTIONS) {
      if (sec.single) {
        const obj = {};
        for (const [k, , t] of fieldsOf(sec)) { const el = root.querySelector(`#f-${sec.key}-${k}`); if (el) obj[k] = fromInput(el.value, t); }
        m[sec.key] = obj;
      } else {
        (m[sec.key] || []).forEach((it, i) => {
          for (const [k, , t] of fieldsOf(sec)) { const el = root.querySelector(`#f-${sec.key}-${i}-${k}`); if (el) it[k] = fromInput(el.value, t); }
          it.__open = root.querySelector(`details[data-sec="${sec.key}"][data-i="${i}"]`)?.open || false;
        });
      }
    }
    return m;
  };
  draw();
  root.oninput = () => onChange?.(clean(read()));
  root.onclick = (e) => {
    const add = e.target.closest("[data-add]"); const del = e.target.closest("[data-del]");
    if (add) { read(); (m[add.dataset.add] ||= []).push({ __open: true }); draw(); onChange?.(clean(m)); }
    if (del) { e.preventDefault(); read(); const [k, i] = del.dataset.del.split(":"); m[k].splice(+i, 1); draw(); onChange?.(clean(m)); }
  };
  return { get: () => clean(read()) };
}

// strip UI-only keys and empty items
export function clean(m) {
  const out = structuredClone(m);
  for (const sec of SECTIONS) {
    if (sec.single || !Array.isArray(out[sec.key])) continue;
    out[sec.key] = out[sec.key].map(({ __open, ...it }) => it).filter((it) => Object.values(it).some((v) => (Array.isArray(v) ? v.length : String(v ?? "").trim())));
  }
  return out;
}

export function masterStats(m) {
  const n = (k) => (m?.[k] || []).length;
  return { roles: n("work_experience") + n("internships"), projects: n("academic_projects") + n("freelance_projects"), achievements: n("academic_achievements"), filled: SECTIONS.filter((s) => (s.single ? Object.values(m?.[s.key] || {}).some((v) => String(v).trim()) : n(s.key) > 0)).length };
}
