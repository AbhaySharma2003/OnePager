// Public configuration. Everything here is safe to ship to the browser:
// the Supabase URL + publishable key are designed to be public (RLS protects the data).
export const SUPABASE_URL = "https://tncqmgquqfimaniesdxk.supabase.co";
export const SUPABASE_KEY = "sb_publishable_SbIDU5cUG77oxFU_y-uq3g_CNbiCY8o";
export const POSTHOG_KEY = ""; // fill in from PostHog > Project settings (public key)
export const POSTHOG_HOST = "https://us.i.posthog.com";
// Pricing shown on the site. What is actually charged is the Dodo product's price, and the free/locked rule
// is enforced by the server (app_config.payments), so keep these in sync with it.
// Flip to true when Dodo is connected (and set app_config.payments.enabled = true on the server).
export const PAYMENTS_LIVE = false;
// Turn on after the Google provider is set up in Supabase (Authentication > Sign In / Providers > Google).
export const GOOGLE_SIGNIN = false;
export const PRICE_INR = 49;
export const FREE_RESUMES = 1;
