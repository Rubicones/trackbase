-- Test-mode paywall: purchase-intent bookkeeping.
-- One row per (user, plan) — repeat submissions upsert, never duplicate.
-- This is NOT an entitlement table; nothing reads it for gating.

create table if not exists public.subscription_intents (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  plan       text not null check (plan in ('solo', 'band', 'band_plus')),
  email      text not null,
  created_at timestamptz not null default now(),
  unique (user_id, plan)
);

-- Writes go through the service-role API route only; no client access.
alter table public.subscription_intents enable row level security;
