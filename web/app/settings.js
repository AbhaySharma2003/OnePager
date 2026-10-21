// Live payment settings from the server: { paymentsLive, price }. Falls back to config.js if unreachable.
import { SUPABASE_URL, PAYMENTS_LIVE, PRICE_LABEL } from "../config.js";
let pending;
export function loadSettings() {
  pending ??= (async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      const r = await fetch(`${SUPABASE_URL}/functions/v1/status`, { signal: ctrl.signal });
      clearTimeout(timer);
      const j = await r.json();
      if (typeof j.payments_live !== "boolean") throw new Error("bad status");
      return { paymentsLive: j.payments_live, price: j.price_label || PRICE_LABEL };
    } catch {
      return { paymentsLive: PAYMENTS_LIVE, price: PRICE_LABEL };
    }
  })();
  return pending;
}
