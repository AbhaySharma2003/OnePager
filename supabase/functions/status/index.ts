// Public, read-only status for the website (no sign-in): is the paywall on, and at what price.
// The site reads this on load, so payments switch on by themselves when Dodo live keys are added.
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { payMode } from "./dodo.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "GET, OPTIONS" };
let cache: { at: number; body: string } | null = null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (!cache || Date.now() - cache.at > 30_000) {
      const { data } = await admin.from("app_config").select("value").eq("key", "payments").maybeSingle();
      const pay = data?.value ?? {};
      const pm = await payMode(admin, pay);
      cache = { at: Date.now(), body: JSON.stringify({ payments_live: pm.on, mode: pm.mode, price_label: String(pay.price_label ?? "$0.90"), free_resumes: Number(pay.free_resumes ?? 1) }) };
    }
    return new Response(cache.body, { headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=30" } });
  } catch (e) {
    console.error("status", e);
    return new Response(JSON.stringify({ payments_live: false, error: "unavailable" }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
