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
import { dodo, payMode, recordPayment } from "./dodo.ts";
import { mergeMaster, missedLines, refineInput, unsupported } from "./facts.ts";

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

async function gemini(c: Cfg, task: "extract" | "generate" | "refine", system: string, user: string, responseSchema: unknown, maxS = Infinity) {
  const m = c.models?.[task] ?? { model: "gemini-flash-latest", temperature: 0.4, thinking: "low" };
  // Try the primary model, then fallbacks (free-tier models return 503/429 under load).
  const chain: string[] = [m.model, ...(m.fallbacks ?? c.models?.fallbacks ?? [])].filter(Boolean);
  const generationConfig: Cfg = { temperature: m.temperature ?? 0.4, responseMimeType: "application/json", responseSchema };
  if (m.thinking) generationConfig.thinkingConfig = { thinkingLevel: m.thinking };
  const body = JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig });
  const deadline = Date.now() + Math.min(m.timeout_s ?? 120, maxS) * 1000;
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

// Prompts live in app_config (prompt_generate, prompt_refine, prompt_extract; synced from data/prompts by
// scripts/sync-config.mjs), so wording can be tuned without a redeploy.
const genPrompt = (c: Cfg) => fill(String(c.prompt_generate_override ?? c.prompt_generate ?? ""), c) + (c.prompt_generate_addendum ? "\n" + c.prompt_generate_addendum : "");
const refinePrompt = (c: Cfg) => fill(String(c.prompt_refine_override ?? c.prompt_refine ?? ""), c) + (c.prompt_refine_addendum ? "\n" + c.prompt_refine_addendum : "");

// CV text -> Master CV. Extraction sometimes drops lines; any CV line whose numbers are missing from the result
// gets one repair pass, so nothing the student wrote is lost before writing starts.
async function extractMaster(c: Cfg, text: string) {
  const sys = fill(c.prompt_extract, c), sch = schema(c.master_schema), cv = `CV TEXT:\n"""\n${text}\n"""`;
  const t0 = Date.now();
  const r = await gemini(c, "extract", sys, cv, sch);
  const missed = missedLines(text, r.data);
  if (!missed.length || Date.now() - t0 > 45_000) return r; // no time left for a second pass
  console.log("extract repair:", missed.length, "lines");
  try {
    // Ask only for the missed facts (small, focused answer), then merge them in with code.
    const r2 = await gemini(c, "extract", sys, `CV LINES MISSING FROM THE MASTER CV:\n${missed.map((l) => "- " + l).join("\n")}\n\nFor context, the full CV:\n${cv}\n\nReturn a Master CV JSON that contains ONLY the facts from the lines above, each under its section with the entry's identifying fields (company / organisation / title, position or designation, dates). Every other section is an empty array.`, sch, 110 - (Date.now() - t0) / 1000);
    const merged = mergeMaster(r.data, r2.data);
    if (missedLines(text, merged).length < missed.length) return { ...r, data: merged };
  } catch (e) { console.warn("extract repair failed", e); }
  return r;
}

// Fit fixes from the stored Master CV. If the answer carries numbers the Master CV doesn't have, one more pass
// removes them before the student ever sees them.
async function refineChecked(c: Cfg, domain: string, problems: unknown, freeLines: unknown, resume: unknown, master: unknown) {
  const t0 = Date.now();
  const r = await gemini(c, "refine", refinePrompt(c), refineInput(domain, problems, freeLines, resume, master), schema(c.onepager_schema));
  if (!unsupported(r.data, master).length || Date.now() - t0 > 45_000) return r;
  console.log("invented numbers:", JSON.stringify(unsupported(r.data, master)).slice(0, 300));
  try {
    const r2 = await gemini(c, "refine", refinePrompt(c), refineInput(domain, [], 0, r.data, master), schema(c.onepager_schema), 110 - (Date.now() - t0) / 1000);
    if (unsupported(r2.data, master).length < unsupported(r.data, master).length) return r2;
  } catch (e) { console.warn("invented-number fix failed", e); }
  return r;
}

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
const view = (row: any, price: string) => {
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
    // Quality-test mode: only when the request carries the EVAL_TOKEN secret (absent = disabled). Uses a supplied
    // Master CV and saves nothing.
    if (typeof body.eval_token === "string" && body.eval_token.length >= 24 && ["extract", "generate", "refine"].includes(action)) {
      const { data: tok } = await admin.rpc("get_app_secret", { secret_name: "EVAL_TOKEN" });
      if (!tok || tok !== body.eval_token) return json({ error: "Please sign in to use OnePager." }, 401);
      if (action === "extract") {
        const r = await extractMaster(c, String(body.text ?? "").slice(0, 60000));
        return json({ master: r.data, model: r.model, ms: Date.now() - t0 });
      }
      if (action === "generate") {
        const domain = String(body.domain ?? "General");
        const user = `TARGET DOMAIN: ${domain}\n${domain === "General" ? "No specific domain: write a strong general-management one-pager." : `DOMAIN KEYWORDS (use only where truthful):\n${keywordsText(body.keywords)}`}\nMASTER CV JSON:\n${JSON.stringify(body.master)}`;
        const genSchema = { type: "object", properties: { resume: schema(c.onepager_schema), flags: c.flags_schema }, required: ["resume", "flags"] };
        const r = await gemini(c, "generate", genPrompt(c), user, genSchema);
        return json({ resume: r.data.resume, flags: r.data.flags, model: r.model, ms: Date.now() - t0 });
      }
      const r = await refineChecked(c, String(body.domain ?? "General"), body.problems, body.freeLines, body.resume, body.master);
      return json({ resume: r.data, model: r.model, ms: Date.now() - t0 });
    }
    // Signed-in students only (anonymous key alone is rejected), with a daily cap per student.
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: who } = await admin.auth.getUser(token);
    if (!who?.user) return json({ error: "Please sign in to use OnePager." }, 401);
    const uid = who.user.id;
    const pay: Cfg = c.payments ?? {};
    const pm = await payMode(admin, pay);
    const price = String(pay.price_label ?? "$0.90");
    const paywallOn = pm.on;
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
      const r = await extractMaster(c, text);
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
      const r = await gemini(c, "generate", genPrompt(c), user, genSchema);
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
      const r = await refineChecked(c, String(res.domain), body.problems, body.freeLines, body.resume, master);
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
      if (!paywallOn) return json({ error: "Payments aren't set up yet. Please try again later." }, 503);
      let ret: URL;
      try { ret = new URL(String(body.return_url ?? "")); } catch { return json({ error: "Bad return URL" }, 400); }
      if (!(pay.return_origins ?? []).includes(ret.origin)) return json({ error: "Return URL not allowed: " + ret.origin }, 400);
      ret.searchParams.set("resume", res.id);
      ret.hash = "";
      const master = await storedMaster();
      const name = String(master?.personal?.name || who.user.email?.split("@")[0] || "Student").slice(0, 80);
      const session = await dodo(admin, pm.mode, "/checkouts", {
        method: "POST",
        body: JSON.stringify({
          product_cart: [{ product_id: pm.productId, quantity: 1 }],
          customer: { email: who.user.email, name },
          return_url: ret.toString(),
          metadata: { resume_id: res.id, user_id: uid },
        }),
      });
      if (!session.checkout_url) throw new Error("Payment provider didn't return a checkout page.");
      await admin.from("payments").insert({ user_id: uid, resume_id: res.id, mode: pm.mode, checkout_session_id: session.session_id ?? null, status: "pending" });
      return json({ checkout_url: session.checkout_url });
    }
    if (action === "confirm") {
      const res = await ownResume(body.id);
      if (!res) return json({ error: "Resume not found." }, 404);
      if (res.status !== "locked") return json({ status: res.status });
      const mode = pm.mode;
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
        const out = await recordPayment(admin, p, { mode, productId: pm.productId || undefined });
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
