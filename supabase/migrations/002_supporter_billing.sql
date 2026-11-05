-- Album-a-Day Supporter entitlement state.
-- Stripe is authoritative; browser clients can only read their own entitlement.

create table if not exists public.supporter_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'inactive',
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  amount integer,
  currency text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  source text not null default 'stripe',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists supporter_entitlements_customer_uidx
  on public.supporter_entitlements(stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists supporter_entitlements_subscription_uidx
  on public.supporter_entitlements(stripe_subscription_id)
  where stripe_subscription_id is not null;

alter table public.supporter_entitlements enable row level security;
revoke all on table public.supporter_entitlements from anon;
revoke insert, update, delete on table public.supporter_entitlements from authenticated;
grant select on table public.supporter_entitlements to authenticated;

drop policy if exists "users read own supporter entitlement" on public.supporter_entitlements;
create policy "users read own supporter entitlement"
  on public.supporter_entitlements
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- The deployed webhook signing secret is inserted out-of-band and must never be committed.
create table if not exists public.billing_webhook_config (
  key text primary key,
  secret_value text not null,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.billing_webhook_config enable row level security;
revoke all on table public.billing_webhook_config from anon, authenticated;
