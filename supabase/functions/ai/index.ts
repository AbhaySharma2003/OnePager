// OnePager AI edge function. Prompts, SOP rules, schemas and model settings live in public.app_config
// (synced from the repo's data/ folder by scripts/sync-config.mjs), so tuning never needs a redeploy.
// The Master CV lives in the backend (public.master_cvs); generation always reads it from there.
//   extract  { text }                                     -> { master }            CV text -> Master CV, saved to master_cvs
//   generate { domain, keywords, role?, jd? }              -> { resume, flags, id } one-pager from the stored Master CV, saved to resumes
//   refine   { id, resume, domain, problems, freeLines }   -> { resume }            fit fixes, facts only from the stored Master CV
//   open     { id }                                        -> { resume, flags, status, ... }  a saved one-pager
//   checkout { id, return_url }                            -> { checkout_url }      Dodo checkout to unlock a locked one-pager
//   confirm  { id, payment_id? }                           -> { status }            verify payment with Dodo and unlock
// Paywall: a student's first one-pager is 'free'; later ones are 'locked' until paid. A locked one-pager never
// leaves the server in readable form: the browser gets a scrambled copy to show blurred behind the pay button.
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { dodo, recordPayment } from "./dodo.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// deno-lint-ignore no-explicit-any
type Cfg = Record<string, any>;
let cfg: Cfg | null = null;
let cfgAt = 0;
async function config(): Promise<Cfg> {
  if (cfg && Date.now() - cfgAt < 60_000) return cfg;
  const { data, error } = await admin.from("app_config").select("key,value");
  if (error) throw new Error("Config unavailable: " + error.message);
  const c: Cfg = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  if (!c.gemini_key) {
    const k = await admin.rpc("get_app_secret", { secret_name: "GEMINI_API_KEY" });
    c.gemini_key = k.data ?? Deno.env.get("GEMINI_API_KEY");
  }
  cfg = c;
  cfgAt = Date.now();
  return c;
}

// Gemini's responseSchema has no $ref support: inline definitions.
// deno-lint-ignore no-explicit-any
function inline(node: any, defs: any): any {
  if (Array.isArray(node)) return node.map((n) => inline(n, defs));
  if (node && typeof node === "object") {
    if (node.$ref) return inline(defs[node.$ref.split("/").pop()], defs);
    // deno-lint-ignore no-explicit-any
    const out: any = {};
    for (const [k, v] of Object.entries(node)) if (k !== "definitions") out[k] = inline(v, defs);
    return out;
  }
  return node;
}
const schema = (raw: Cfg) => inline(raw, raw.definitions ?? {});

const fill = (tpl: string, c: Cfg) =>
  tpl.replaceAll("{{RULES}}", c.rules_text ?? "")
    .replaceAll("{{MASTER_GUIDELINES}}", c.master_guidelines ?? "")
    .replaceAll("{{SECTION_ORDER}}", (c.section_order ?? []).join(" > "));

async function gemini(c: Cfg, task: "extract" | "generate" | "refine", system: string, user: string, responseSchema: unknown) {
  const m = c.models?.[task] ?? { model: "gemini-flash-latest", temperature: 0.4, thinking: "low" };
  // Try the primary model, then fallbacks (free-tier models return 503/429 under load).
  const chain: string[] = [m.model, ...(m.fallbacks ?? c.models?.fallbacks ?? [])].filter(Boolean);
  const generationConfig: Cfg = { temperature: m.temperature ?? 0.4, responseMimeType: "application/json", responseSchema };
  if (m.thinking) generationConfig.thinkingConfig = { thinkingLevel: m.thinking };
  const body = JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig });
  const deadline = Date.now() + (m.timeout_s ?? 120) * 1000;
  let lastErr = "";
  // Free-tier Gemini often answers 503 "high demand" for a few seconds. Go round the model chain up to 3 times,
  // pausing between rounds, until the deadline.
  const rounds = Number(m.rounds ?? 3);
  for (let round = 0; round < rounds; round++) {
  if (round > 0) {
    const pause = round === 1 ? 4000 : 9000;
    if (deadline - Date.now() < pause + 15000) break;
    await new Promise((r) => setTimeout(r, pause));
  }
  let busyOnly = true;
  for (const model of chain) {
    const left = deadline - Date.now();
    if (left < 8000) break;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(left, (m.per_model_s ?? 50) * 1000));
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": c.gemini_key },
        body,
        signal: ctrl.signal,
      });
      if (r.ok) {
        const j = await r.json();
        const text = j?.candidates?.[0]?.content?.parts?.filter((p: Cfg) => !p.thought).map((p: Cfg) => p.text ?? "").join("") ?? "";
        try { return { data: JSON.parse(text), usage: j.usageMetadata, model: j.modelVersion ?? model }; }
        catch { lastErr = `${model} returned invalid JSON`; }
      } else {
        lastErr = `Gemini ${model} ${r.status}: ${(await r.text()).slice(0, 200)}`;
        console.warn(lastErr);
        if (r.status !== 503 && r.status !== 429) busyOnly = false;
        if (r.status === 400 || r.status === 401 || r.status === 403) { round = rounds; break; }
      }
    } catch (e) {
      busyOnly = false;
      lastErr = (e as Error).name === "AbortError" ? "AI took too long, please try again" : (e as Error).message;
    } finally {
      clearTimeout(timer);
    }
  }
  if (!busyOnly) break; // only "busy" answers are worth another round
  }
  throw new Error(lastErr.includes("503") || lastErr.includes("429") ? "The AI is busy right now. Please try again in a minute." : lastErr);
}

// Default prompts ship with the code (source: data/prompts/*.md, embedded by scripts/embed-prompts.mjs).
// app_config keys prompt_<task>_override replace them; prompt_<task>_addendum appends extra rules without a redeploy.
const GENERATE_PROMPT = "You are a business-school career-services resume writer. From a student's Master CV you write the content of their ONE-PAGE resume in the classic one-page business-school template, targeted at one domain.\n\nFACT LOCK (most important rule, never break it):\n- Use ONLY facts present in the MASTER CV JSON. Every number, %, ₹ amount, date, month, year, city, company, title, tool, certification and score in your output must appear in the Master CV.\n- Do NOT invent or estimate: no made-up percentages (e.g. \"100% compliance\"), no guessed months or years, no guessed cities, no new job titles, no \"Remote\".\n- If a date, month or location is not in the Master CV, leave that field empty (\"\"). If only a year is known, use the year only (e.g. \"2023\").\n- Do not output contact details; leave header fields empty. The app fills them from the student's profile.\n- Certifications and online courses go ONLY in Certifications, never in Projects or Experience.\n\nHARD RULES (official SOP, follow every one):\n{{RULES}}\n\nHOW TO WRITE\n- Section order: {{SECTION_ORDER}}. Use an empty array for a section the student has nothing strong for.\n- Professional summary: 50-60 words, 3 lines, starts with a descriptor or action verb (never \"I\"), names the professional identity for the target domain, includes 2-3 quantified spikes taken from the Master CV. Plain sentences.\n- Every bullet: Result-Action-Context. Lead with the result, then the action, then the context. Strong past-tense action verbs (Spearheaded, Drove, Built, Led, Reduced, Increased, Launched, Negotiated...). No first person, no full stop at the end.\n- LENGTH (critical): one bullet = one printed line = 95-105 characters including spaces, counting the text without ** markers. Bold text is wider, so keep bold phrases short. Example of the right length and shape (format only; never reuse its facts):\n  \"Cut month-end reporting time by **40%** by automating 12 Excel trackers into one **Power BI** dashboard\"\n- Bold: mark 1-2 short phrases per bullet with **double asterisks** (numbers, results, domain keywords). Never bold more than 5 words in a bullet.\n- Sub-skill headings: only for a role with 4 or more bullets; then split them into 2 groups each with a short heading (plain text, no underscores or markdown). Otherwise leave heading empty.\n- Quantify only with numbers from the Master CV. If a bullet would be much stronger with a number the student did not give, write it without the number and add a flag asking for it.\n- Weave in domain keywords (listed below) naturally, only where truthful.\n- Experience/internship entries: org = company name in CAPS; org_description = short context only if stated in the Master CV; role = designation exactly as given; dates like Jul’22-Apr’24 (typographic apostrophe, no spaces) only from Master CV dates; location = city only if given.\n- Education: newest first. Institution names in CAPS, spelled exactly as the institution writes its own name. Programmes in full form (e.g. \"MBA in Finance\", \"B.Tech in Computer Science\"), never bare abbreviations. Separate facts with \" | \". Class X / XII in Roman numerals. Include CGPA/% only if at least 8.0/10 or 80%. Dates like 2025-Present or 2020-2024.\n- Projects: academic, live, freelance, research or college projects only, with role, actions and outcome.\n- Certifications: credible and relevant to the domain, max 3-4; name | issuing organisation; date only if given; usually no bullet.\n- Achievements: scholarships, ranks, exam scores, awards with scale (\"1 of 50\").\n- Leadership: positions of responsibility with team size/footfall/sponsorship. Extra-curricular: sports, cultural, public speaking with rank and level. Social Impact: volunteering/NGO work.\n- Skills: Business Skills and Technical Skills, 4-7 items each, only skills evidenced elsewhere in the resume, favouring the domain keywords.\n- PAGE BUDGET: fill ONE A4 page: about 66 printed lines including entry headers (org line, role line, sub-skill headings, education lines). Aim for 62-66 lines: if the student has enough material, use it (more bullets for the most relevant roles); prioritise relevance to the target domain and recency.\n- Spelling and grammar must be perfect. Indian English conventions (₹, lakh/crore).\n- flags: list every place where the student should add or confirm information (missing numbers, missing dates or locations, missing contact info). Be specific and short.\n";

const REFINE_PROMPT = "You fix fit problems in a one-page business-school resume (Calibri 9pt; one printed line holds about 100 characters of plain text, fewer when words are bold). You receive the resume JSON, the student's Master CV and a fit report measured on the real page renderer.\n\nFACT LOCK: use only facts from the Master CV. Never invent numbers, dates, places, titles or outcomes.\n\n- \"wraps\": the bullet spills onto a second line. Rewrite it to at most target_chars characters (plain text, not counting ** markers), keeping the key result, numbers and 1-2 short **bold** phrases. Cut filler words first.\n- \"short\": the bullet leaves the line half empty. Lengthen it to about target_chars characters using ONLY facts from the Master CV (context, scale, tools, outcome).\n- \"page_overflow\": remove the given number of lines by dropping the least relevant bullets for the target domain (weak certifications, minor activities first). Never remove education or contact details.\n- freeLines > 2: the page has empty space. Add up to (freeLines - 1) strong, relevant bullets from the Master CV to the most relevant roles, each 95-105 characters.\n- Change nothing else. Keep every SOP rule:\n{{RULES}}\n";

// Same shape and length, unreadable: shown blurred behind the pay button.
const LETTERS = "etaoinshrdlucmfwypbgvk";
const pick = () => LETTERS[Math.floor(Math.random() * LETTERS.length)];
// deno-lint-ignore no-explicit-any
const scramble = (v: any): any =>
  typeof v === "string" ? v.replace(/[a-z]/g, pick).replace(/[A-Z]/g, () => pick().toUpperCase()).replace(/[0-9]/g, () => String(Math.floor(Math.random() * 10)))
  : Array.isArray(v) ? v.map(scramble)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scramble(x)]))
  : v;
const UNLOCKED = new Set(["free", "paid", "draft"]);
// deno-lint-ignore no-explicit-any
const view = (row: any, price: number) => {
  const locked = row.status === "locked";
  return {
    id: row.id, status: row.status, domain: row.domain, role: row.target_role ?? "", rewrites: row.rewrites ?? 0, price,
    resume: locked ? scramble(row.data) : row.data, flags: locked ? [] : (row.flags ?? []),
  };
};

const keywordsText = (kw: unknown) =>
  (Array.isArray(kw) ? kw : []).slice(0, 12).map((g: { group?: string; keywords?: string[] }) =>
    `${String(g.group ?? "").slice(0, 60)}: ${(g.keywords ?? []).slice(0, 120).map((k) => String(k).slice(0, 60)).join(", ")}`
  ).join("\n");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: Cfg;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const action = String(body.action ?? "");
  const t0 = Date.now();
  try {
    const c = await config();
    // Signed-in students only (anonymous key alone is rejected), with a daily cap per student.
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: who } = await admin.auth.getUser(token);
    if (!who?.user) return json({ error: "Please sign in to use OnePager." }, 401);
    const uid = who.user.id;
    const pay: Cfg = c.payments ?? {};
    const price = Number(pay.price_inr ?? 49);
    const paywallOn = pay.enabled !== false;
    const rewriteCap = Number(pay.rewrites_per_resume ?? 3);
    if (["extract", "generate", "refine"].includes(action)) {
      const limit = Number(c.limits?.daily_ai_calls ?? 40);
      const { data: used } = await admin.rpc("bump_ai_usage", { p_user: uid, p_limit: limit });
      if (typeof used === "number" && used < 0) return json({ error: `Daily limit of ${limit} AI actions reached. Try again tomorrow.` }, 429);
    }
    const storedMaster = async () => {
      const { data } = await admin.from("master_cvs").select("data").eq("user_id", uid).maybeSingle();
      return data?.data && Object.keys(data.data).length ? data.data : null;
    };
    const ownResume = async (id: unknown) => {
      if (!id) return null;
      const { data } = await admin.from("resumes").select("id,user_id,status,data,flags,domain,target_role,rewrites").eq("id", String(id)).maybeSingle();
      return data && data.user_id === uid ? data : null;
    };

    if (action === "extract") {
      const text = String(body.text ?? "").slice(0, 60000);
      if (text.trim().length < 80) return json({ error: "Could not read enough text from the CV. Try another file or fill the form." }, 422);
      const r = await gemini(c, "extract", fill(c.prompt_extract, c), `CV TEXT:\n"""\n${text}\n"""`, schema(c.master_schema));
      const { error: saveErr } = await admin.from("master_cvs").upsert({ user_id: uid, data: r.data, source: "upload", updated_at: new Date().toISOString() });
      if (saveErr) throw new Error("Could not save your Master CV: " + saveErr.message);
      return json({ master: r.data, model: r.model, ms: Date.now() - t0, usage: r.usage });
    }
    if (action === "generate") {
      // Rewriting an existing one-pager keeps its id, domain and paid status (up to rewrites_per_resume times).
      const existing = body.id ? await ownResume(body.id) : null;
      if (body.id && !existing) return json({ error: "Resume not found." }, 404);
      if (existing && existing.rewrites >= rewriteCap) return json({ error: `You've used all ${rewriteCap} rewrites for this one-pager. Edit the text directly, or create a new one-pager.` }, 429);
      const domain = existing ? existing.domain : String(body.domain ?? "");
      if (!(c.domains ?? []).includes(domain)) return json({ error: `Unknown domain. Use one of: ${(c.domains ?? []).join(", ")}` }, 400);
      const master = await storedMaster();
      if (!master) return json({ error: "We couldn't find your Master CV. Upload your CV or fill the form first." }, 400);
      const user = `TARGET DOMAIN: ${domain}${body.role ? `\nTARGET ROLE: ${String(body.role).slice(0, 120)}` : ""}
${domain === "General" ? "No specific domain: write a strong general-management one-pager." : `DOMAIN KEYWORDS (use only where truthful):\n${keywordsText(body.keywords)}`}
${body.jd ? `\nJOB DESCRIPTION (tailor to it):\n"""\n${String(body.jd).slice(0, 8000)}\n"""` : ""}
MASTER CV JSON:
${JSON.stringify(master)}`;
      const genSchema = { type: "object", properties: { resume: schema(c.onepager_schema), flags: c.flags_schema }, required: ["resume", "flags"] };
      const r = await gemini(c, "generate", fill((c.prompt_generate_override ?? GENERATE_PROMPT) + (c.prompt_generate_addendum ? "\n" + c.prompt_generate_addendum : ""), c), user, genSchema);
      const role = String(body.role ?? "").slice(0, 120) || null;
      let row;
      if (existing) {
        const { data, error } = await admin.from("resumes").update({ data: r.data.resume, flags: r.data.flags ?? [], target_role: role, rewrites: existing.rewrites + 1 })
          .eq("id", existing.id).select("id,user_id,status,data,flags,domain,target_role,rewrites").single();
        if (error) throw new Error("Could not save your one-pager: " + error.message);
        row = data;
      } else {
        // First one-pager is free; the unique index allows only one 'free' row per student.
        const base = { user_id: uid, domain, target_role: role, data: r.data.resume, flags: r.data.flags ?? [] };
        const cols = "id,user_id,status,data,flags,domain,target_role,rewrites";
        let ins = await admin.from("resumes").insert({ ...base, status: paywallOn ? "free" : "draft" }).select(cols).single();
        if (ins.error?.code === "23505") ins = await admin.from("resumes").insert({ ...base, status: "locked" }).select(cols).single();
        if (ins.error) throw new Error("Could not save your one-pager: " + ins.error.message);
        row = ins.data;
      }
      return json({ ...view(row, price), model: r.model, ms: Date.now() - t0 });
    }
    if (action === "refine") {
      const res = await ownResume(body.id);
      if (!res) return json({ error: "Resume not found." }, 404);
      if (!UNLOCKED.has(res.status)) return json({ error: "Unlock this one-pager first." }, 402);
      const master = await storedMaster();
      if (!master) return json({ error: "We couldn't find your Master CV." }, 400);
      const user = `TARGET DOMAIN: ${res.domain}
FIT REPORT: ${JSON.stringify({ problems: body.problems, freeLines: body.freeLines })}
CURRENT RESUME JSON:
${JSON.stringify(body.resume)}
MASTER CV JSON (source of truth for any added facts):
${JSON.stringify(master)}`;
      const r = await gemini(c, "refine", fill((c.prompt_refine_override ?? REFINE_PROMPT) + (c.prompt_refine_addendum ? "\n" + c.prompt_refine_addendum : ""), c), user, schema(c.onepager_schema));
      return json({ resume: r.data, model: r.model, ms: Date.now() - t0, usage: r.usage });
    }
    if (action === "open") {
      const res = await ownResume(body.id);
      if (!res) return json({ error: "Resume not found." }, 404);
      return json(view(res, price));
    }
    if (action === "checkout") {
      const res = await ownResume(body.id);
      if (!res) return json({ error: "Resume not found." }, 404);
      if (res.status !== "locked") return json({ status: res.status });
      if (!paywallOn || !pay.product_id) return json({ error: "Payments aren't set up yet. Please try again later." }, 503);
      let ret: URL;
      try { ret = new URL(String(body.return_url ?? "")); } catch { return json({ error: "Bad return URL" }, 400); }
      if (!(pay.return_origins ?? []).includes(ret.origin)) return json({ error: "Return URL not allowed: " + ret.origin }, 400);
      ret.searchParams.set("resume", res.id);
      ret.hash = "";
      const master = await storedMaster();
      const name = String(master?.personal?.name || who.user.email?.split("@")[0] || "Student").slice(0, 80);
      const session = await dodo(admin, pay.mode ?? "test", "/checkouts", {
        method: "POST",
        body: JSON.stringify({
          product_cart: [{ product_id: pay.product_id, quantity: 1 }],
          customer: { email: who.user.email, name },
          return_url: ret.toString(),
          metadata: { resume_id: res.id, user_id: uid },
        }),
      });
      if (!session.checkout_url) throw new Error("Payment provider didn't return a checkout page.");
      await admin.from("payments").insert({ user_id: uid, resume_id: res.id, mode: pay.mode ?? "test", checkout_session_id: session.session_id ?? null, status: "pending" });
      return json({ checkout_url: session.checkout_url });
    }
    if (action === "confirm") {
      const res = await ownResume(body.id);
      if (!res) return json({ error: "Resume not found." }, 404);
      if (res.status !== "locked") return json({ status: res.status });
      const mode = pay.mode ?? "test";
      // Payment ids to check: the one Dodo put on the return URL, plus any from this resume's recent checkouts.
      const ids = new Set<string>();
      if (typeof body.payment_id === "string" && /^[\w-]{4,80}$/.test(body.payment_id)) ids.add(body.payment_id);
      const { data: recent } = await admin.from("payments").select("checkout_session_id,payment_id").eq("resume_id", res.id).eq("user_id", uid).order("created_at", { ascending: false }).limit(3);
      for (const p of recent ?? []) {
        if (p.payment_id) { ids.add(p.payment_id); continue; }
        if (!p.checkout_session_id) continue;
        try { const s = await dodo(admin, mode, `/checkouts/${encodeURIComponent(p.checkout_session_id)}`); if (s.payment_id) ids.add(s.payment_id); }
        catch (e) { console.warn("checkout lookup", e); }
      }
      let status = "locked";
      for (const pid of ids) {
        let p;
        try { p = await dodo(admin, mode, `/payments/${encodeURIComponent(pid)}`); } catch (e) { console.warn("payment lookup", pid, e); continue; }
        if (p?.metadata?.resume_id !== res.id || p?.metadata?.user_id !== uid) continue; // someone else's payment
        const out = await recordPayment(admin, p, { mode, productId: pay.product_id || undefined });
        if (out.unlocked) { status = "paid"; break; }
        if (["failed", "cancelled"].includes(p.status)) status = p.status === "failed" ? "failed" : "cancelled";
        else if (p.status) status = "processing";
      }
      return json({ status });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error(action, Date.now() - t0, e);
    return json({ error: (e as Error).message }, 502);
  }
});
