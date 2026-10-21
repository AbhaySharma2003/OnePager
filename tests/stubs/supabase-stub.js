// Test double for supabase-js. In-memory tables persisted in sessionStorage (survives the checkout redirect),
// and a fake `ai` edge function that mirrors the real server's paywall: first one-pager free, later ones
// locked + scrambled until a (fake) Dodo payment is confirmed.
const fixtures = window.__FIXTURES__ || {};
const opts = window.__STUB__ || {};
const KEY = "__stub_db";
const db = JSON.parse(sessionStorage.getItem(KEY) || "null") || { master_cvs: [], resumes: [], events: [], paid: [], signedIn: !opts.signedOut };
const persist = () => sessionStorage.setItem(KEY, JSON.stringify(db));
const user = { id: "u1", email: "student@example.com" };
const listeners = [];

function q(table) {
  const st = { table, filters: [], op: "select", payload: null };
  const api = {
    select() { return api; }, eq(k, v) { st.filters.push([k, v]); return api; }, order() { return api; }, limit() { return api; },
    insert(p) { st.op = "insert"; st.payload = p; return api; }, upsert(p) { st.op = "upsert"; st.payload = p; return api; }, update(p) { st.op = "update"; st.payload = p; return api; },
    maybeSingle() { return run(true); }, single() { return run(true); }, then(res, rej) { return run(false).then(res, rej); },
  };
  async function run(one) {
    const rows = db[table];
    if (table === "resumes" && st.op === "insert") return { data: null, error: { message: "permission denied for table resumes" } };
    if (st.op === "upsert") { rows.splice(0, rows.length, st.payload); persist(); return { data: st.payload, error: null }; }
    if (st.op === "update") {
      const r = rows.find((x) => st.filters.every(([k, v]) => x[k] === v));
      if (table === "resumes" && r?.status === "locked") return { data: null, error: null }; // RLS: no rows updated
      Object.assign(r || {}, st.payload); persist(); return { data: r, error: null };
    }
    if (st.op === "insert") { rows.push(st.payload); persist(); return { data: st.payload, error: null }; }
    // column privileges: the browser can't read resume content
    const hit = rows.filter((x) => st.filters.every(([k, v]) => x[k] === v)).map((x) => table === "resumes" ? { id: x.id, domain: x.domain, target_role: x.target_role, status: x.status, created_at: x.created_at } : x);
    return { data: one ? hit[0] ?? null : hit, error: null };
  }
  return api;
}

const scramble = (v) => typeof v === "string" ? v.replace(/[a-z]/g, "x").replace(/[A-Z]/g, "X").replace(/[0-9]/g, "0")
  : Array.isArray(v) ? v.map(scramble) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scramble(x)])) : v;
const view = (r) => ({ id: r.id, status: r.status, domain: r.domain, role: r.target_role || "", price: "$0.90", resume: r.status === "locked" ? scramble(r.data) : r.data, flags: [] });

const server = {
  extract: () => { db.master_cvs = [{ user_id: user.id, data: fixtures.extract.master, source: "upload", updated_at: new Date().toISOString() }]; return fixtures.extract; },
  generate: (b) => {
    if (b.id) { const r = db.resumes.find((x) => x.id === b.id); r.data = fixtures.generate.resume; return view(r); }
    const hasFree = db.resumes.some((r) => r.status === "free");
    const r = { id: "r" + (db.resumes.length + 1), user_id: user.id, domain: b.domain, target_role: b.role, data: fixtures.generate.resume, status: hasFree ? "locked" : "free", created_at: new Date().toISOString() };
    db.resumes.push(r); return view(r);
  },
  refine: (b) => { if (opts.refineBusy) throw new Error("The AI is busy right now. Please try again in a minute."); const r = db.resumes.find((x) => x.id === b.id); if (!r || r.status === "locked") throw new Error("Unlock this one-pager first."); return fixtures.refine; },
  open: (b) => view(db.resumes.find((x) => x.id === b.id)),
  checkout: (b) => {
    const r = db.resumes.find((x) => x.id === b.id);
    if (r.status !== "locked") return { status: r.status };
    const ret = new URL(b.return_url); ret.searchParams.set("resume", r.id);
    return { checkout_url: `${location.origin}/__dodo?return=${encodeURIComponent(ret)}&resume=${r.id}` };
  },
  confirm: (b) => {
    const r = db.resumes.find((x) => x.id === b.id);
    if (r.status === "locked" && db.paid.includes(b.payment_id)) r.status = "paid";
    return { status: r.status };
  },
};

export function createClient() {
  return {
    auth: {
      getUser: async () => ({ data: { user: db.signedIn ? user : null } }),
      getSession: async () => ({ data: { session: db.signedIn ? { user } : null } }),
      onAuthStateChange: (cb) => { listeners.push(cb); if (db.signedIn) setTimeout(() => cb("SIGNED_IN", { user }), 0); return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: async () => ({}), signInWithOAuth: async () => ({}),
      signInWithOtp: async ({ email }) => { window.__otp = email; if (/ratelimit/.test(email)) return { error: new Error("email rate limit exceeded") }; return { error: null }; },
      verifyOtp: async ({ token }) => {
        if (token !== "123456") return { error: new Error("Token has expired or is invalid") };
        db.signedIn = true; persist(); listeners.forEach((cb) => cb("SIGNED_IN", { user })); return { error: null };
      },
    },
    from: q,
    functions: {
      invoke: async (_n, { body }) => {
        await new Promise((r) => setTimeout(r, 150));
        window.__calls = (window.__calls || []).concat(body.action);
        try { const data = server[body.action](body); persist(); return { data, error: null }; }
        catch (e) { return { data: { error: e.message }, error: null }; }
      },
    },
  };
}
