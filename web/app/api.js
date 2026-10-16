// Supabase client, auth helpers and calls to the `ai` edge function.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.58.0/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "../config.js";

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, detectSessionInUrl: true } });

// Signed-in user from the local session (fast, no network). The server re-checks the token on every call.
export async function currentUser() {
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}

export async function signInWithGoogle() {
  const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.href.split("#")[0] } });
  if (error) throw error;
}
export async function sendEmailCode(email) {
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href.split("#")[0] } });
  if (error) throw error;
}
export async function verifyEmailCode(email, token) {
  const { error } = await sb.auth.verifyOtp({ email, token, type: "email" });
  if (error) throw error;
}
export const signOut = () => sb.auth.signOut();

async function ai(body) {
  const { data, error } = await sb.functions.invoke("ai", { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); msg = j.error || msg; } catch { /* keep generic */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
export const extractMaster = (text) => ai({ action: "extract", text });
// The server reads the student's stored Master CV; the browser only sends the target.
export const generateResume = (p) => ai({ action: "generate", ...p });
export const refineResume = (p) => ai({ action: "refine", ...p });
// One-pager content always comes through the function: a locked one-pager arrives scrambled.
export const openResume = (id) => ai({ action: "open", id });
// Payments (Dodo): start a checkout for a locked one-pager, then confirm it on return.
export const startCheckout = (id, returnUrl) => ai({ action: "checkout", id, return_url: returnUrl });
export const confirmPayment = (id, paymentId) => ai({ action: "confirm", id, payment_id: paymentId || undefined });

// Persistence (RLS: each student only sees their own rows)
export async function loadMaster() {
  const u = await currentUser(); if (!u) return null;
  const { data } = await sb.from("master_cvs").select("data,source,updated_at").eq("user_id", u.id).maybeSingle();
  return data;
}
export async function saveMaster(master, source) {
  const u = await currentUser(); if (!u) return;
  await sb.from("master_cvs").upsert({ user_id: u.id, data: master, source, updated_at: new Date().toISOString() });
}
// One-pagers are created by the server; the browser saves fit results and edits to unlocked ones only.
export async function saveResume({ id, data, flags }) {
  if (!id) return null;
  const { error } = await sb.from("resumes").update({ data, flags }).eq("id", id);
  if (error) throw error;
  return id;
}
export async function listResumes() {
  const { data } = await sb.from("resumes").select("id,domain,target_role,status,created_at,updated_at").order("created_at", { ascending: false }).limit(20);
  return data ?? [];
}
export async function track(name, props = {}) {
  try {
    const u = await currentUser();
    if (u) await sb.from("events").insert({ user_id: u.id, name, props });
    window.posthog?.capture?.(name, props);
  } catch { /* analytics must never break the app */ }
}
