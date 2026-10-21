// Finds Master CV facts that are not on the one-pager yet, so the "fill empty space" step adds real
// content instead of padding. A fact counts as used when its numbers are on the page (or, for a fact
// without numbers, when most of its words are).
// deno-lint-ignore no-explicit-any
type Any = any;

const SKIP = new Set(["personal", "skills", "interests"]);
const LABEL_KEYS = ["company", "organisation", "title", "institute", "issuer", "activity", "name"];
const STOP = new Set("a an the and of to for in on at by with from via into across over as is was were their its this that while used".split(" "));
const words = (t: string) =>
  (t.toLowerCase().replace(/\*\*/g, "").match(/[a-z][a-z0-9]+/g) ?? []).filter((w) => !STOP.has(w)).map((w) => w.replace(/(ing|ed|es|s)$/, ""));
// Significant numbers: 2+ digits or a decimal ("31,000" -> "31000", "Rs 2.1 crore" -> "2.1", "22%" -> "22").
const numbers = (t: string) =>
  (t.replace(/\*\*/g, "").match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, "")).filter((n) => n.length >= 2);

function collect(master: Any): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = [];
  const add = (label: string, s: unknown) => {
    for (const part of String(s ?? "").split(/\.\s+(?=[A-Z])/)) {
      const text = part.trim().replace(/\.$/, "");
      if (text.length >= 12) out.push({ label, text });
    }
  };
  for (const [section, items] of Object.entries(master ?? {})) {
    if (SKIP.has(section) || !Array.isArray(items)) continue;
    for (const it of items) {
      if (typeof it === "string") { add(section, it); continue; }
      if (!it || typeof it !== "object") continue;
      const label = LABEL_KEYS.map((k) => it[k]).find((v) => typeof v === "string" && v) ?? section;
      for (const [k, v] of Object.entries(it)) {
        if (Array.isArray(v)) v.forEach((x) => typeof x === "string" && add(label, x));
        else if (["description", "text", "outcome", "details"].includes(k)) add(label, v);
      }
    }
  }
  // Drop exact repeats (extract sometimes stores the same line twice).
  const seen = new Set<string>();
  return out.filter((f) => !seen.has(f.text.toLowerCase()) && !!seen.add(f.text.toLowerCase()));
}

function pageText(resume: Any): string {
  const parts: string[] = [];
  const walk = (o: unknown) => {
    if (typeof o === "string") parts.push(o);
    else if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) if (k !== "header" && k !== "flags") walk(v);
  };
  walk(resume);
  return parts.join(" \n ");
}

export function unusedFacts(master: Any, resume: Any, max = 12): string[] {
  const page = pageText(resume);
  const pageNums = new Set(numbers(page));
  const pageWords = new Set(words(page));
  const out: string[] = [];
  for (const f of collect(master)) {
    const n = numbers(f.text);
    const missing = n.filter((x) => !pageNums.has(x));
    let used: boolean;
    if (n.length) used = !missing.length;
    else {
      const w = words(f.text);
      used = !w.length || w.filter((x) => pageWords.has(x)).length / w.length >= 0.6;
    }
    // A long line that is partly on the page: say which numbers are still missing, so the AI adds only those.
    const partly = missing.length && missing.length < n.length ? ` (already on the page except: ${missing.join(", ")})` : "";
    if (!used) out.push(`[${f.label}] ${f.text}${partly}`);
    if (out.length >= max) break;
  }
  return out;
}

// CV lines whose numbers never made it into the Master CV (extraction dropped them).
export function missedLines(cvText: string, master: Any, max = 25): string[] {
  const have = new Set(numbers(JSON.stringify(master ?? {})));
  return cvText.split(/\n+/).map((l) => l.trim()).filter((l) => l && numbers(l).some((n) => !have.has(n))).slice(0, max);
}

// Merge a Master CV fragment (only the missed facts) into the full Master CV. Entries are matched by their
// identifying field (company, organisation, title...); list fields are unioned, empty fields filled.
const ID_KEYS = ["company", "organisation", "title", "institute", "activity", "competition", "name", "text", "position", "designation"];
const key = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function mergeMaster(master: Any, extra: Any): Any {
  const out: Any = structuredClone(master ?? {});
  for (const [section, items] of Object.entries(extra ?? {})) {
    if (!Array.isArray(items)) continue;
    const list: Any[] = Array.isArray(out[section]) ? out[section] : (out[section] = []);
    for (const it of items) {
      if (typeof it === "string") { if (!list.some((x) => key(x) === key(it))) list.push(it); continue; }
      if (!it || typeof it !== "object") continue;
      // Same entry when an identifying field shares most of its words ("Rotaract Club, Fergusson College" = "Rotaract Club of Fergusson College").
      const toks = (v: unknown) => new Set(key(v).split(" ").filter((w) => w.length > 2 && w !== "the" && w !== "and"));
      const alike = (a: unknown, b: unknown) => {
        const A = toks(a), B = toks(b);
        if (!A.size || !B.size) return false;
        return [...A].filter((w) => B.has(w)).length / Math.min(A.size, B.size) >= 0.8;
      };
      // Organisation-like fields decide when both entries have one; a title alone only when neither does.
      const same = list.find((x) => {
        if (!x || typeof x !== "object") return false;
        const k = ID_KEYS.find((f) => x[f] && it[f]);
        return !!k && alike(x[k], it[k]);
      });
      if (!same) { list.push(it); continue; }
      for (const [k, v] of Object.entries(it)) {
        if (Array.isArray(v)) {
          const cur: unknown[] = Array.isArray(same[k]) ? same[k] : (same[k] = []);
          for (const x of v) if (!cur.some((y) => key(y) === key(x))) cur.push(x);
        } else if (v && !same[k]) same[k] = v;
        else if (typeof v === "string" && typeof same[k] === "string" && v.length > same[k].length && v.includes(same[k].slice(0, 20))) same[k] = v;
      }
    }
  }
  return out;
}

// Numbers on the one-pager that the Master CV doesn't contain: invented by the AI. Returns the lines that carry them.
export function unsupported(resume: Any, master: Any): { text: string; numbers: string[] }[] {
  const have = new Set(numbers(JSON.stringify(master ?? {})));
  const out: { text: string; numbers: string[] }[] = [];
  const walk = (o: unknown, key = "") => {
    if (typeof o === "string") {
      if (key === "dates") return; // date formats (Jul'22) are reshaped on purpose
      const bad = numbers(o).filter((n) => !have.has(n));
      if (bad.length) out.push({ text: o, numbers: bad });
    } else if (Array.isArray(o)) o.forEach((x) => walk(x, key));
    else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) if (k !== "header" && k !== "flags") walk(v, k);
  };
  walk(resume);
  return out;
}

// The refine request text, shared by the signed-in and quality-test paths.
export function refineInput(domain: string, problems: unknown, freeLines: unknown, resume: Any, master: Any): string {
  const free = Number(freeLines ?? 0);
  const unused = free >= 3 ? unusedFacts(master, resume) : [];
  const invented = unsupported(resume, master).map((u) => ({ type: "invented", text: u.text, numbers_not_in_master_cv: u.numbers }));
  const all = [...invented, ...(Array.isArray(problems) ? problems : [])];
  return `TARGET DOMAIN: ${domain}
FIT REPORT: ${JSON.stringify({ problems: all, freeLines: free })}
${unused.length ? `UNUSED MASTER CV FACTS (true, relevant and not on the page yet; use these first to fill the free lines):\n${unused.map((u) => "- " + u).join("\n")}\n` : free >= 3 ? "UNUSED MASTER CV FACTS: none found. Fill space only by splitting bullets that join two separate achievements, or leave the lines free.\n" : ""}CURRENT RESUME JSON:
${JSON.stringify(resume)}
MASTER CV JSON (source of truth for any added facts):
${JSON.stringify(master)}`;
}
