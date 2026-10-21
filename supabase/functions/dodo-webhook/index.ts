// Dodo Payments webhook. Dodo calls this URL on payment events; we verify the signature
// (Standard Webhooks, secret DODO_WEBHOOK_SECRET) and unlock the paid resume.
// Deployed with JWT verification off: Dodo doesn't send a Supabase token, the signature is the auth.
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { recordPayment, verifyWebhook, webhookSecrets } from "./dodo.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const body = await req.text();
  // Test and live endpoints share this URL; the secret that verifies the signature tells us which mode sent it.
  const keys = await webhookSecrets(admin);
  if (!keys.live && !keys.test) { console.error("No Dodo webhook secret is set"); return new Response("not configured", { status: 500 }); }
  let mode: "live" | "test" | null = null;
  if (keys.live && (await verifyWebhook(keys.live, req.headers, body))) mode = "live";
  else if (keys.test && (await verifyWebhook(keys.test, req.headers, body))) mode = "test";
  if (!mode) return new Response("invalid signature", { status: 401 });

  // deno-lint-ignore no-explicit-any
  let evt: any;
  try { evt = JSON.parse(body); } catch { return new Response("bad json", { status: 400 }); }
  const id = req.headers.get("webhook-id")!;
  try {
    const { data: cfgRow } = await admin.from("app_config").select("value").eq("key", "payments").maybeSingle();
    const pay = cfgRow?.value ?? {};
    let result: unknown = { ignored: true };
    if (String(evt.type ?? "").startsWith("payment.") && evt.data?.payment_id)
      result = await recordPayment(admin, evt.data, { mode, productId: (mode === "live" ? pay.product_id_live : (pay.product_id_test ?? pay.product_id)) || undefined, raw: evt });
    await admin.from("webhook_events").upsert({ id, type: evt.type ?? null, payload: evt });
    console.log("webhook", evt.type, id, JSON.stringify(result));
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("webhook failed", id, e);
    return new Response("error", { status: 500 }); // Dodo retries
  }
});
