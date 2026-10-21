-- Helpers for one-step go-live (see README → Payments). Server-only (service_role).

-- Store or replace a Vault secret (used for the live webhook signing key that the server creates itself).
create or replace function public.set_app_secret(secret_name text, secret_value text)
returns void language plpgsql security definer set search_path to '' as $$
declare sid uuid;
begin
  select id into sid from vault.secrets where name = secret_name limit 1;
  if sid is null then perform vault.create_secret(secret_value, secret_name);
  else perform vault.update_secret(sid, secret_value); end if;
end $$;

-- Merge keys into app_config.payments.
create or replace function public.patch_payments(patch jsonb)
returns void language sql security definer set search_path to '' as $$
  update public.app_config set value = value || patch, updated_at = now() where key = 'payments';
$$;

-- One server instance at a time may run live setup; retry allowed after 10 minutes.
create or replace function public.claim_live_setup()
returns boolean language plpgsql security definer set search_path to '' as $$
begin
  update public.app_config
     set value = value || jsonb_build_object('live_setup_at', now()), updated_at = now()
   where key = 'payments'
     and coalesce(value->>'product_id_live', '') = ''
     and coalesce((value->>'live_setup_at')::timestamptz, 'epoch'::timestamptz) < now() - interval '10 minutes';
  return found;
end $$;

revoke all on function public.set_app_secret(text, text) from public, anon, authenticated;
revoke all on function public.patch_payments(jsonb) from public, anon, authenticated;
revoke all on function public.claim_live_setup() from public, anon, authenticated;
grant execute on function public.set_app_secret(text, text) to service_role;
grant execute on function public.patch_payments(jsonb) to service_role;
grant execute on function public.claim_live_setup() to service_role;
