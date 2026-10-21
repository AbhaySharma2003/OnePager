// Public configuration. Everything here is safe to ship to the browser:
// the Supabase URL + publishable key are designed to be public (RLS protects the data).
export const SUPABASE_URL = "https://tncqmgquqfimaniesdxk.supabase.co";
export const SUPABASE_KEY = "sb_publishable_SbIDU5cUG77oxFU_y-uq3g_CNbiCY8o";
export const POSTHOG_KEY = ""; // fill in from PostHog > Project settings (public key)
export const POSTHOG_HOST = "https://us.i.posthog.com";
// Payments: the site asks the server (functions/v1/status) whether the paywall is on and what it costs, so it
// switches on by itself when Dodo live keys are added. These two are only fallbacks if that check fails.
export const PAYMENTS_LIVE = false;
export const PRICE_LABEL = "$0.90";
// Turn on after the Google provider is set up in Supabase (Authentication > Sign In / Providers > Google).
export const GOOGLE_SIGNIN = false;
export const FREE_RESUMES = 1;
