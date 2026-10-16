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
  const over = fit.problems.find((p) => p.type === "page_overflow");
  if (over) problems.unshift({ type: "page_overflow", lines_to_remove: over.linesOver });
  return { problems, freeLines: Math.max(0, fit.freeLines) };
}

export const needsWork = (fit) => !fit.fits || fit.freeLines > 3 || fit.bullets.some((b) => b.lines > 1 || b.fill < 0.72);

// header stays the student's own (never AI-written)
export async function autoFit({ id, resume, domain, header, container, rounds = 2, onStep }) {
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
  return { resume: current, fit, page, error };
}
export { plainLen };
