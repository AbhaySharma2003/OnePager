// Automatic SOP checks on a one-pager JSON (the 'auto' rules in data/rules.json).
// Layout rules (font, size, grid, alignment, italics, hyperlinks) are guaranteed by the renderer;
// line-fit and one-page checks come from checkFit() in render.js.
// Returns [{ id, level: 'error'|'warn', section, message }]

const plain = (s) => String(s ?? "").replace(/\*\*/g, "");
const words = (s) => plain(s).trim().split(/\s+/).filter(Boolean).length;
const DATE_RANGE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[’'](\d{2})\s?-\s?((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[’']\d{2}|Present)$/;
const MONTH_DATE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[’']\d{2}$/;
const YEAR_RANGE = /^(19|20)\d{2}\s?-\s?((19|20)\d{2}|Present)$/;
const HAS_NUMBER = /\d|₹|%|\b(one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|lakh|crore)\b/i;

function entries(d) {
  const out = [];
  for (const [key, label] of [["experience", "Experience"], ["internships", "Internships"], ["projects", "Projects"], ["leadership", "Leadership"], ["social_impact", "Social Impact"]])
    for (const e of d[key] || []) out.push({ key, label, e });
  return out;
}
const allBullets = (e) => (e.groups || []).flatMap((g) => g.bullets || []);

export function validate(d) {
  const issues = [];
  const add = (id, level, section, message) => issues.push({ id, level, section, message });
  const h = d.header || {};

  // Header
  if (!h.name) add("header_fields", "error", "Header", "Add your full name.");
  if (!h.email) add("header_fields", "error", "Header", "Add your email ID.");
  if (!h.phone) add("header_fields", "error", "Header", "Add your phone number.");
  if (!h.linkedin) add("header_fields", "error", "Header", "Add your LinkedIn profile (full URL).");
  else if (!/^https?:\/\/(www\.)?linkedin\.com\/in\//i.test(h.linkedin)) add("header_fields", "warn", "Header", "LinkedIn should be the full URL, e.g. https://www.linkedin.com/in/your-name/");

  // Summary
  if (!d.summary) add("summary_length", "error", "Professional Summary", "Professional summary is mandatory.");
  else {
    const n = words(d.summary);
    if (n < 50 || n > 60) add("summary_length", "warn", "Professional Summary", `Summary is ${n} words; SOP asks for 50–60.`);
    if (/^\s*I\b/.test(plain(d.summary))) add("summary_start", "error", "Professional Summary", "Don't start the summary with “I”.");
    if (!HAS_NUMBER.test(d.summary)) add("summary_start", "warn", "Professional Summary", "Add at least one measurable achievement to the summary.");
  }

  // Education
  const edu = d.education || [];
  if (!edu.length) add("edu_verification", "error", "Education", "Education is mandatory.");
  edu.forEach((e) => {
    if (/^\s*(MBA|PGP|PGDM|BBA|B\.?Tech|BE|B\.?Com)\s*$/i.test(plain(e.program || "").split("|")[0])) add("edu_program", "warn", "Education", `Write the programme in full form, e.g. "MBA in Finance" instead of "${plain(e.program).split("|")[0].trim()}".`);
  });
  edu.forEach((e) => {
    if (e.institution && e.institution !== e.institution.toUpperCase()) add("capitalization", "warn", "Education", `Institution names should be in CAPS: ${e.institution}`);
    if (!e.dates) add("edu_verification", "error", "Education", `Add the years for ${e.institution}.`);
    else if (!YEAR_RANGE.test(e.dates) && !/^(19|20)\d{2}$/.test(e.dates)) add("edu_timeline", "warn", "Education", `Use the year format 2021-2025 or 2025-Present (found “${e.dates}”).`);
    const txt = [e.program, ...(e.details || [])].join(" ");
    if (/Class\s*(10|12)(th)?\b/i.test(txt)) add("edu_format", "error", "Education", "Write Class X and Class XII in Roman numerals.");
    // Only score-like segments (Class/CGPA/board marks), not scholarships or waivers.
    const scoreSegs = txt.split("|").filter((seg) => /class|cgpa|gpa|grade|score|board|cbse|icse|marks|percentage/i.test(seg) && !/scholarship|waiver|stipend/i.test(seg));
    for (const seg of scoreSegs) {
      for (const m of seg.matchAll(/(\d+(?:\.\d+)?)\s*\/\s*10\b/g)) if (parseFloat(m[1]) < 8) add("edu_score", "warn", "Education", `CGPA ${m[1]}/10 is below 8.0; SOP says mention it only if above 80%.`);
      for (const m of seg.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) if (parseFloat(m[1]) < 80) add("edu_score", "warn", "Education", `${m[1]}% is below 80%; SOP says mention it only if above 80%.`);
    }
  });
  const startYear = (s) => parseInt(String(s || "").match(/(19|20)\d{2}/)?.[0] || "0", 10);
  for (let i = 1; i < edu.length; i++) if (startYear(edu[i].dates) > startYear(edu[i - 1].dates)) { add("edu_order", "error", "Education", "List education in reverse chronological order (latest first)."); break; }

  // Experience-like entries
  for (const { key, label, e } of entries(d)) {
    if (["experience", "internships"].includes(key)) {
      if (!e.role) add("exp_verification", "error", label, `Add the designation for ${e.org}.`);
      if (!e.dates) add("exp_verification", "error", label, `Add the duration for ${e.org}.`);
      if (e.org && e.org !== e.org.toUpperCase() && !/Pvt\.|Ltd\./.test(e.org)) add("capitalization", "warn", label, `Company names should be in CAPS like institutions: ${e.org}`);
    }
    if (e.dates && !DATE_RANGE.test(e.dates) && !MONTH_DATE.test(e.dates) && !YEAR_RANGE.test(e.dates) && !/^(19|20)\d{2}$/.test(e.dates) && key !== "leadership")
      add(key === "projects" ? "proj_timeline" : "exp_timeline", "warn", label, `Use the date format Apr’24-Jul’24 (found “${e.dates}” for ${e.org}).`);
    const bl = allBullets(e);
    if (["experience", "internships", "projects"].includes(key) && bl.length && !bl.some((b) => HAS_NUMBER.test(b)))
      add(key === "projects" ? "proj_outcome" : "exp_quant", "warn", label, `No measurable outcome in ${e.org}. Add numbers (%, ₹, count, scale).`);
    for (const b of bl) if (/\.\s*$/.test(plain(b))) { add("separators", "warn", label, `Bullets shouldn't end with a full stop (${e.org}).`); break; }
  }

  // Skills
  const sk = d.skills || {};
  if (!(sk.business || []).length && !(sk.technical || []).length) add("skills_relevance", "error", "Skills", "Skills section is mandatory.");
  const nSkills = (sk.business || []).length + (sk.technical || []).length;
  if (nSkills > 16) add("skills_concise", "warn", "Skills", `${nSkills} skills listed; keep it concise (8–14).`);

  // Proofreading hygiene the machine can catch
  const allText = JSON.stringify(d);
  if (/\s{2,}\w/.test(plain(allText).replace(/\\n/g, " "))) add("proofreading", "warn", "General", "Double spaces found; tidy spacing.");
  if (/\*\*[^*]*$/.test(allText.replace(/\*\*[^*]*\*\*/g, ""))) add("proofreading", "warn", "General", "Unclosed bold marker (**).");
  return issues;
}

// Anti-hallucination check: every number, year and month-year in the resume must exist in the Master CV.
// Returns warnings the student must confirm before downloading.
export function checkFacts(resume, master) {
  const src = JSON.stringify(master ?? {}).toLowerCase().replace(/,/g, "");
  const norm = (n) => n.replace(/,/g, "");
  const issues = [];
  const seen = new Set();
  const visit = (section, text) => {
    const t = String(text ?? "").replace(/\*\*/g, "");
    for (const m of t.matchAll(/\d+(?:[.,]\d+)*\s*%?/g)) {
      const raw = m[0].trim(), num = norm(raw.replace("%", "").trim());
      if (num.length === 0 || seen.has(section + num)) continue;
      // Allow small structural numbers (Class X/XII, 1 of N) and digits from dates handled below.
      if (/^(10|12)$/.test(num) && /class/i.test(t)) continue;
      if (!src.includes(num.toLowerCase())) { seen.add(section + num); issues.push({ id: "fact_number", level: "warn", section, message: `“${raw}” isn’t in your Master CV. Confirm it’s accurate or remove it.` }); }
    }
  };
  const visitDate = (section, org, dates) => {
    for (const m of String(dates ?? "").matchAll(/([A-Z][a-z]{2})[’'](\d{2})/g)) {
      const mon = m[1].toLowerCase(), yy = m[2];
      if (!(src.includes(`20${yy}`) && src.includes(mon))) issues.push({ id: "fact_date", level: "warn", section, message: `Date ${m[0]} for ${org} isn’t in your Master CV. Please confirm.` });
    }
  };
  visit("Professional Summary", resume.summary);
  for (const key of ["experience", "internships", "projects", "leadership", "social_impact"]) {
    for (const e of resume[key] || []) {
      visitDate(key, e.org, e.dates);
      if (e.location && !src.includes(String(e.location).toLowerCase())) issues.push({ id: "fact_place", level: "warn", section: key, message: `Location “${e.location}” for ${e.org} isn’t in your Master CV.` });
      for (const g of e.groups || []) for (const b of g.bullets || []) visit(key, b);
    }
  }
  for (const b of resume.achievements || []) visit("achievements", b);
  for (const b of resume.extracurricular || []) visit("extracurricular", b);
  for (const c of resume.certifications || []) visitDate("certifications", c.name, c.dates);
  return issues;
}
