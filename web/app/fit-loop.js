// Measures the rendered resume and asks the AI to fix only what doesn't fit.
// Up to `rounds` passes: wrapping bullets get shortened to a measured character budget,
// half-empty bullets get lengthened, overflow gets trimmed, empty space gets filled.
import { renderResume, checkFit } from "../resume/render.js";
import { refineResume } from "./api.js";

const plainLen = (s) => String(s).replace(/\*\*/g, "").length;

// Convert checkFit's measurements into precise instructions for the AI.
export function fitReport(fit) {
  const problems = [];
  for (const b of fit.bullets) {
    const len = b.text.length;
    if (b.lines > 1) {
      const perLine = len / (b.lines - 1 + Math.max(b.fill, 0.05));
      problems.push({ type: "wraps", text: b.text, target_chars: Math.floor(perLine * 0.96) });
    } else if (b.fill < 0.72) {
      const perLine = len / Math.max(b.fill, 0.2);
      problems.push({ type: "short", text: b.text, target_chars: Math.floor(perLine * 0.93) });
    }
  }
  for (const [a, b] of duplicates(fit.bullets.map((x) => x.text))) problems.push({ type: "duplicate", text: b, same_as: a });
  const over = fit.problems.find((p) => p.type === "page_overflow");
  if (over) problems.unshift({ type: "page_overflow", lines_to_remove: over.linesOver });
  // Lines the "wraps" fixes will free count as free too, so the same pass refills them with real content.
  const wrapLines = fit.bullets.reduce((n, b) => n + (b.lines > 1 ? b.lines - 1 : 0), 0);
  return { problems, freeLines: fit.fits ? Math.max(0, fit.freeLines) + wrapLines : 0 };
}

// Last resort after the final round: remove the later bullet of any remaining duplicate pair.
const norm = (t) => String(t).replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
export function dropBullets(resume, texts) {
  // Number every list string in page order, then drop the LAST occurrence of each target (once).
  let i = 0;
  const seen = [];
  const scan = (o) => Array.isArray(o) ? o.forEach((x) => (typeof x === "string" ? seen.push(norm(x)) : scan(x)))
    : o && typeof o === "object" && Object.entries(o).forEach(([k, v]) => k !== "header" && scan(v));
  scan(resume);
  const drop = new Set(texts.map((t) => seen.lastIndexOf(norm(t))).filter((n) => n >= 0));
  const walk = (o) => Array.isArray(o)
    ? o.flatMap((x) => (typeof x === "string" ? (drop.has(i++) ? [] : [x]) : [walk(x)]))
    : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === "header" ? v : walk(v)])) : o;
  return walk(resume);
}

// Bullets that restate each other: mostly the same (stemmed) words, the same number plus similar words,
// or the same 3-word phrase. Repeats are what an AI pads a page with, so they are fixed like overflow.
const STOP = new Set("a an the and of to for in on at by with from via into across over as is was were their its this that while".split(" "));
const stem = (w) => w.replace(/(ing|ed|es|s)$/, "");
const toks = (t) => (t.toLowerCase().replace(/\*\*/g, "").match(/[a-z0-9.,%₹]+/g) ?? []).map((w) => w.replace(/[.,]+$/, "")).filter((w) => w && !STOP.has(w)).map(stem);
const nums = (t) => new Set((t.replace(/\*\*/g, "").match(/\d[\d.,]*\s*(?:%|lakh|cr|crore|k|l\b)?/gi) ?? []).map((n) => n.replace(/[\s,]/g, "").toLowerCase()).filter((n) => n.replace(/\D/g, "").length >= 2));
const tri = (a) => new Set(a.slice(2).map((_, i) => a.slice(i, i + 3).join(" ")));
export function duplicates(texts) {
  const out = [], T = texts.map(toks), W = T.map((a) => new Set(a)), N = texts.map(nums), G = T.map(tri);
  const df = new Map();
  for (const w of W) for (const t of w) df.set(t, (df.get(t) ?? 0) + 1);
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const shared = [...W[i]].filter((w) => W[j].has(w)), inter = shared.length, ov = inter / (Math.min(W[i].size, W[j].size) || 1);
    // A bullet without numbers that shares 2+ uncommon words (a tool, a channel) with another bullet usually
    // restates its action: "Redesigned the onboarding journey with CleverTap" vs "...by redesigning CleverTap journeys".
    const rare = shared.filter((w) => w.length >= 5 && df.get(w) === 2 && !/\d/.test(w)).length;
    if ((!N[i].size || !N[j].size) && rare >= 2 && ov >= 0.25) { out.push([texts[i], texts[j]]); continue; }
    const sharedNum = [...N[i]].some((n) => N[j].has(n)), sharedTri = [...G[i]].some((g) => G[j].has(g));
    // Both carry numbers but share none: different facts, unless the wording is nearly identical.
    const distinct = N[i].size > 0 && N[j].size > 0 && !sharedNum;
    if (distinct ? ov >= 0.7 : ov >= 0.5 || (ov >= 0.4 && sharedNum) || (sharedTri && ov >= 0.3)) out.push([texts[i], texts[j]]);
  }
  return out;
}

export const needsWork = (fit) => !fit.fits || fit.freeLines > 2 || duplicates(fit.bullets.map((x) => x.text)).length > 0 || fit.bullets.some((b) => b.lines > 1 || b.fill < 0.72);

// header stays the student's own (never AI-written)
export async function autoFit({ id, resume, domain, header, container, rounds = 3, onStep }) {
  let current = resume;
  let page = renderResume({ ...current, header }, container);
  await document.fonts.ready;
  let fit = checkFit(page);
  let error = null;
  for (let i = 0; i < rounds && needsWork(fit); i++) {
    onStep?.(i + 1, fit);
    const rep = fitReport(fit);
    // A busy AI must not lose the resume: keep what we have and report the problem.
    let next;
    try { ({ resume: next } = await refineResume({ id, resume: { ...current, header: undefined }, domain, ...rep })); }
    catch (e) { error = e; break; }
    if (!next) break;
    current = next;
    page = renderResume({ ...current, header }, container);
    fit = checkFit(page);
  }
  const dups = duplicates(fit.bullets.map((x) => x.text));
  if (dups.length) {
    current = dropBullets(current, dups.map(([, later]) => later));
    page = renderResume({ ...current, header }, container);
    fit = checkFit(page);
  }
  return { resume: current, fit, page, error };
}
export { plainLen };
