// Dodo Payments helpers shared by the `ai` and `dodo-webhook` edge functions.
// Copied next to each function at deploy time (scripts/sync-shared.mjs) so each bundle is self-contained.
// Secrets come from Edge Function secrets, then Supabase Vault. Test: DODO_API_KEY(_TEST), DODO_WEBHOOK_SECRET(_TEST).
// Live: only DODO_API_KEY_LIVE is pasted by hand; the live webhook signing key is stored in Vault by setupLive.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.58.0";

// deno-lint-ignore no-explicit-any
type Any = Record<string, any>;

export async function secret(admin: SupabaseClient, name: string): Promise<string | null> {
  const env = Deno.env.get(name);
  if (env) return env;
  const { data } = await admin.rpc("get_app_secret", { secret_name: name });
  return (data as string | null) ?? null;
}

export const dodoBase = (mode: string) => (mode === "live" ? "https://live.dodopayments.com" : "https://test.dodopayments.com");

// Keys per mode. Test: DODO_API_KEY_TEST (or the older DODO_API_KEY). Live: DODO_API_KEY_LIVE only.
const apiKey = async (admin: SupabaseClient, mode: string) =>
  mode === "live" ? await secret(admin, "DODO_API_KEY_LIVE") : (await secret(admin, "DODO_API_KEY_TEST")) ?? (await secret(admin, "DODO_API_KEY"));
export const webhookSecrets = async (admin: SupabaseClient) => ({
  live: await secret(admin, "DODO_WEBHOOK_SECRET_LIVE"),
  test: (await secret(admin, "DODO_WEBHOOK_SECRET_TEST")) ?? (await secret(admin, "DODO_WEBHOOK_SECRET")),
});

// Which Dodo mode is active and whether the paywall is on.
// payments.mode "auto" (default): live as soon as DODO_API_KEY_LIVE exists. The first request that sees the
// live key creates the live product and webhook itself (setupLive), so going live needs only that one secret.
// The paywall is on in live mode; in test mode only when payments.test_paywall is true (for testing),
// so test checkouts never gate real users. payments.enabled = false switches everything off.
export async function payMode(admin: SupabaseClient, pay: Any): Promise<{ mode: "test" | "live"; productId: string; on: boolean }> {
  const want = String(pay.mode ?? "auto");
  const liveKey = await secret(admin, "DODO_API_KEY_LIVE");
  if (liveKey && !pay.product_id_live && want !== "test" && pay.enabled !== false) {
    try { pay.product_id_live = await setupLive(admin, pay); } catch (e) { console.error("live setup failed", e); }
  }
  const liveReady = !!pay.product_id_live && !!liveKey;
  const mode = want === "live" || (want === "auto" && liveReady) ? "live" : "test";
  const productId = String((mode === "live" ? pay.product_id_live : (pay.product_id_test ?? pay.product_id)) ?? "");
  const on = pay.enabled !== false && !!productId && (mode === "live" ? liveReady : pay.test_paywall === true);
  return { mode, productId, on };
}

const WEBHOOK_EVENTS = ["payment.succeeded", "payment.failed", "payment.cancelled", "payment.processing"];

// One-time live setup, run by whichever request first sees DODO_API_KEY_LIVE:
// creates the live product at the configured price, then a live webhook whose signing key is stored in Vault.
// Returns the live product id ("" if another instance is already doing it).
async function setupLive(admin: SupabaseClient, pay: Any): Promise<string> {
  const { data: claimed } = await admin.rpc("claim_live_setup");
  if (!claimed) {
    // Someone else is on it (or finished a moment ago): use whatever is stored now.
    const { data } = await admin.from("app_config").select("value").eq("key", "payments").maybeSingle();
    return String(data?.value?.product_id_live ?? "");
  }
  const product = await dodo(admin, "live", "/products", {
    method: "POST",
    body: JSON.stringify({
      name: String(pay.product_name ?? "OnePager Resume Unlock"),
      description: "Unlock one AI-written one-page resume: PDF and Word downloads plus AI rewrites.",
      tax_category: String(pay.tax_category ?? "saas"),
      price: {
        type: "one_time_price", price: Number(pay.price_cents ?? 90), currency: String(pay.currency ?? "USD"),
        discount: 0, purchasing_power_parity: false, tax_inclusive: true,
      },
    }),
  });
  const productId = String(product.product_id ?? "");
  if (!productId) throw new Error("Dodo did not return a product id");
  await admin.rpc("patch_payments", { patch: { product_id_live: productId, live_since: new Date().toISOString() } });
  console.log("live product created", productId);

  // Webhook: a backup that unlocks a resume even if the buyer closes the tab before returning.
  if (!(await secret(admin, "DODO_WEBHOOK_SECRET_LIVE"))) {
    try {
      const hook = await dodo(admin, "live", "/webhooks", {
        method: "POST",
        body: JSON.stringify({ url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/dodo-webhook`, filter_types: WEBHOOK_EVENTS, description: "OnePager unlocks" }),
      });
      const { secret: signing } = await dodo(admin, "live", `/webhooks/${encodeURIComponent(hook.id)}/secret`);
      if (!signing) throw new Error("no signing key returned");
      const { error } = await admin.rpc("set_app_secret", { secret_name: "DODO_WEBHOOK_SECRET_LIVE", secret_value: signing });
      if (error) throw error;
      await admin.rpc("patch_payments", { patch: { webhook_id_live: hook.id } });
      console.log("live webhook created", hook.id);
    } catch (e) { console.error("live webhook setup failed (payments still confirm on return)", e); }
  }
  return productId;
}

export async function dodo(admin: SupabaseClient, mode: string, path: string, init: RequestInit = {}): Promise<Any> {
  const key = await apiKey(admin, mode);
  if (!key) throw new Error("Payments aren't set up yet. Please try again later.");
  const r = await fetch(dodoBase(mode) + path, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
  });
  const text = await r.text();
  if (!r.ok) {
    console.error(`Dodo ${init.method ?? "GET"} ${path} -> ${r.status}: ${text.slice(0, 300)}`);
    throw new Error(r.status === 401 ? "Payment provider rejected our key. Please contact support." : "Payment provider error. Please try again.");
  }
  return text ? JSON.parse(text) : {};
}

// Record a payment we have verified (signed webhook, or fetched from Dodo's API with our key).
// Unlocks the resume named in its metadata when it succeeded. Safe to call repeatedly.
export async function recordPayment(admin: SupabaseClient, p: Any, opts: { mode: string; productId?: string; raw?: unknown }) {
  const meta = p?.metadata ?? {};
  const resumeId = String(meta.resume_id ?? ""), userId = String(meta.user_id ?? "");
  const paymentId = String(p?.payment_id ?? "");
  if (!resumeId || !userId || !paymentId) return { unlocked: false, reason: "not a OnePager payment" };
  // If Dodo tells us what was bought, it must be our product.
  const cart: Any[] | undefined = p.product_cart;
  if (opts.productId && Array.isArray(cart) && cart.length && !cart.some((i) => i.product_id === opts.productId))
    return { unlocked: false, reason: "different product" };

  const status = String(p.status ?? "unknown");
  const row = {
    user_id: userId, resume_id: resumeId, mode: opts.mode, payment_id: paymentId, status,
    amount: typeof p.total_amount === "number" ? p.total_amount : null, currency: p.currency ?? null,
    updated_at: new Date().toISOString(), raw: opts.raw ?? p,
  };
  // Attach to the row created at checkout when we can, otherwise record it by payment id.
  let saved = false;
  if (p.checkout_session_id) {
    const { data } = await admin.from("payments").update(row).eq("checkout_session_id", p.checkout_session_id).select("id");
    saved = !!data?.length;
  }
  if (!saved) await admin.from("payments").upsert({ ...row, checkout_session_id: p.checkout_session_id ?? null }, { onConflict: "payment_id" });

  if (status !== "succeeded") return { unlocked: false, reason: status };
  const { data: res } = await admin.from("resumes").select("id,user_id,status").eq("id", resumeId).maybeSingle();
  if (!res || res.user_id !== userId) return { unlocked: false, reason: "resume not found" };
  if (res.status === "locked") {
    const { error } = await admin.from("resumes").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", resumeId).eq("status", "locked");
    if (error) throw new Error("Could not unlock: " + error.message);
  }
  return { unlocked: true };
}

// Standard Webhooks signature check (what Dodo uses): base64(HMAC-SHA256(key, `${id}.${timestamp}.${body}`)).
export async function verifyWebhook(secretValue: string, headers: Headers, body: string, toleranceS = 300): Promise<boolean> {
  const id = headers.get("webhook-id"), ts = headers.get("webhook-timestamp"), sigs = headers.get("webhook-signature");
  if (!id || !ts || !sigs) return false;
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > toleranceS) return false;
  const raw = secretValue.startsWith("whsec_") ? secretValue.slice(6) : secretValue;
  let keyBytes: Uint8Array<ArrayBuffer>;
  try { keyBytes = Uint8Array.from(atob(raw), (ch) => ch.charCodeAt(0)); }
  catch { keyBytes = new TextEncoder().encode(raw); }
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  const expected = btoa(String.fromCharCode(...mac));
  return sigs.split(" ").some((part) => {
    const [ver, sig] = part.split(",");
    return ver === "v1" && !!sig && timingSafeEqual(sig, expected);
  });
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
