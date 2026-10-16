# OnePager

AI resume builder for business-school students: Master CV in, SOP-compliant one-page resume out.

## How it works
1. Student uploads an old CV (PDF/DOCX), a Master CV Excel, or fills the Master CV form.
2. AI (Gemini, via a Supabase Edge Function) structures it into the Master CV format.
3. Student picks a target domain (9 domains, each with a keyword list) and optional JD.
4. AI writes the one-pager following the resume SOPs; the browser renders it in the one-page template,
   measures every line, and asks the AI to fix bullets that spill over or leave the line half empty.
5. Automatic SOP checks + fact-check (no invented numbers/dates), then Download PDF.

## Layout
| Path | What |
|---|---|
| `web/` | The website (static, served by GitHub Pages). `index.html` landing, `app.html` app |
| `web/resume/` | One-page template renderer (`render.js`, `resume.css`), SOP validator, Carlito fonts |
| `web/app/` | App logic: Supabase client, file text extraction, Master CV form, fit loop |
| `supabase/functions/ai/` | Edge function: extract / generate / refine (Gemini) |
| `supabase/sql/` | Config rows for `public.app_config` (generated) |
| `data/` | Source of truth: SOP rules, domain keywords, schemas, prompts, model settings |
| `inputs/` | Private reference files (not committed) |
| `scripts/` | `sync-config.mjs` (data -> SQL + web keywords), `embed-prompts.mjs` (prompts -> function) |
| `tests/` | Renderer + app smoke tests (Playwright) |

## Run locally
```
npm install
npx serve web        # or any static server, then open http://localhost:3000/app.html
node tests/render.mjs tests/fixtures/template_replica.json tests/out/replica
```

## Deploy
- Website: push to `main`; GitHub Actions publishes `web/` to Pages (Settings > Pages > Source: GitHub Actions).
- Edge function: `npx supabase functions deploy ai --project-ref tncqmgquqfimaniesdxk`
- Prompt/rule changes: edit `data/`, run `node scripts/sync-config.mjs`, apply `supabase/sql/app_config.sql`.

Secrets (Gemini key) live only in Supabase Vault, never in this repo.

## Payments (Dodo)

- A student's **first one-pager is free**. Every later one-pager is written, fitted and checked, but stays **locked**:
  the browser only receives a scrambled copy (shown blurred) until the student pays ₹49 for that one-pager.
- Each one-pager includes up to 3 rewrites (`app_config.payments.rewrites_per_resume`).
- Flow: `ai` function `checkout` creates a Dodo checkout session (metadata: resume_id, user_id) → student pays on Dodo →
  Dodo returns to `app.html?resume=…&payment_id=…&status=…` → `confirm` verifies the payment with Dodo's API and unlocks.
  The `dodo-webhook` function (signature-verified) also unlocks on `payment.succeeded`, so a closed tab still gets unlocked.
- Settings: `app_config.payments` (`mode` test|live, `product_id`, `price_inr`, `return_origins`).
  Secrets (Supabase → Edge Functions → Secrets): `DODO_API_KEY`, `DODO_WEBHOOK_SECRET`.
- Webhook URL to register in Dodo: `https://tncqmgquqfimaniesdxk.supabase.co/functions/v1/dodo-webhook`
- Database: `supabase/sql/payments.sql`. Students can't read resume content directly (column privileges), can't insert
  resumes, and can't change `status`; only the edge functions can.
- Before deploying either function, run `node scripts/sync-shared.mjs` (copies `_shared/dodo.ts` next to each function).
- Test: `node tests/pay-smoke.mjs` (free → locked → fake checkout → unlocked).
