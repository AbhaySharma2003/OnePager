-- Payments + free-first paywall.
-- Rule: a student's first one-pager is free. Every later one-pager is generated in full but stays
-- 'locked' (the browser only ever receives a scrambled preview) until a Dodo payment unlocks it.
-- resumes.status: 'free' | 'locked' | 'paid' (legacy 'draft' = unlocked). Only the service role may change it.

alter table public.resumes drop constraint if exists resumes_status_check;
alter table public.resumes add constraint resumes_status_check check (status in ('draft', 'unlocked', 'free', 'locked', 'paid'));
alter table public.resumes add column if not exists rewrites int not null default 0;
alter table public.resumes add column if not exists paid_at timestamptz;

-- At most one free resume per student (also closes the race of two parallel "first" generations).
create unique index if not exists resumes_one_free_per_user on public.resumes (user_id) where status = 'free';

-- The browser may list its resumes, but never read the content column directly
-- (content comes from the `ai` function, which scrambles locked resumes).
revoke select, insert, update, delete on public.resumes from anon, authenticated;
grant select (id, user_id, domain, target_role, status, rewrites, created_at, updated_at) on public.resumes to authenticated;
-- Students can save their own edits to unlocked resumes only. Status stays protected by the trigger.
grant update (data, flags, target_role) on public.resumes to authenticated;
alter policy "own resumes update" on public.resumes
  using (user_id = (select auth.uid()) and status <> 'locked')
  with check (user_id = (select auth.uid()) and status <> 'locked');

-- Payment records (written only by the edge functions with the service role).
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  resume_id uuid references public.resumes (id) on delete set null,
  provider text not null default 'dodo',
  mode text not null default 'test',
  checkout_session_id text unique,
  payment_id text unique,
  status text not null default 'pending',
  amount int,
  currency text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  raw jsonb
);
create index if not exists payments_resume_idx on public.payments (resume_id);
create index if not exists payments_user_idx on public.payments (user_id);
alter table public.payments enable row level security;
revoke all on public.payments from anon, authenticated;
grant select (id, resume_id, status, amount, currency, created_at) on public.payments to authenticated;
create policy "own payments read" on public.payments for select to authenticated using (user_id = (select auth.uid()));

-- Webhook deliveries already processed (Dodo retries; process each webhook-id once).
create table if not exists public.webhook_events (
  id text primary key,
  type text,
  received_at timestamptz not null default now(),
  payload jsonb
);
alter table public.webhook_events enable row level security;
revoke all on public.webhook_events from anon, authenticated;

-- Payment settings (not secret). The Dodo API key and webhook secret live in Edge Function secrets / Vault.
insert into public.app_config (key, value) values ('payments', jsonb_build_object(
  'enabled', true,
  'mode', 'test',
  'product_id', '',
  'price_inr', 49,
  'free_resumes', 1,
  'rewrites_per_resume', 3,
  'return_origins', jsonb_build_array('http://localhost:3000', 'https://abhaysharma2003.github.io')
)) on conflict (key) do nothing;
