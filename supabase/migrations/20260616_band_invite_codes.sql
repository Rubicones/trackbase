-- ─── Band invite codes + join requests ────────────────────────────────────────
-- Replaces single-use invite links with human-readable codes and owner approval.

alter table public.bands
  add column if not exists invite_code text;

create unique index if not exists bands_invite_code_unique
  on public.bands (invite_code)
  where invite_code is not null;

create table if not exists public.band_join_requests (
  id          uuid primary key default gen_random_uuid(),
  band_id     uuid not null references public.bands(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  status      text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  resolved_by uuid references auth.users(id) on delete set null
);

-- Only one pending request per user per band at a time.
create unique index if not exists band_join_requests_one_pending
  on public.band_join_requests (band_id, user_id)
  where status = 'pending';

create index if not exists band_join_requests_band_pending
  on public.band_join_requests (band_id)
  where status = 'pending';

create index if not exists band_join_requests_user_pending
  on public.band_join_requests (user_id)
  where status = 'pending';

alter table public.band_join_requests enable row level security;

-- Users can read their own requests.
create policy "band_join_requests_select_own" on public.band_join_requests
  for select using (auth.uid() = user_id);

-- Band owners can read pending requests for their bands.
create policy "band_join_requests_select_owner" on public.band_join_requests
  for select using (
    exists (
      select 1 from public.band_members bm
      where bm.band_id = band_join_requests.band_id
        and bm.user_id = auth.uid()
        and bm.role = 'owner'
    )
  );

-- Users can create join requests for themselves.
create policy "band_join_requests_insert_own" on public.band_join_requests
  for insert with check (auth.uid() = user_id and status = 'pending');
