-- ─── 001_auth.sql ─────────────────────────────────────────────────────────────
-- Adds profiles, band_invites, and membership role columns.
-- Run via Supabase dashboard → SQL editor, or `supabase db push`.

-- ─── Profiles ─────────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text unique not null,
  display_name  text,
  avatar_color  text,         -- optional manual override; NULL = deterministic
  created_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Anyone can read profiles (for member lists, avatars etc.)
create policy "profiles_select" on public.profiles
  for select using (true);

-- Users can only update their own profile
create policy "profiles_update" on public.profiles
  for update using (auth.uid() = id);

-- ─── Band members: add role columns ──────────────────────────────────────────
-- role_label and role_color are free-form display strings ("Drummer", "Producer").
-- If the column already exists this is a no-op thanks to IF NOT EXISTS.

alter table public.band_members
  add column if not exists role_label text,
  add column if not exists role_color text;   -- e.g. "#6366F1"

-- ─── Band invites ─────────────────────────────────────────────────────────────

create table if not exists public.band_invites (
  id          uuid primary key default gen_random_uuid(),
  band_id     uuid not null references public.bands(id) on delete cascade,
  token       text unique not null default encode(gen_random_bytes(24), 'base64url'),
  created_by  uuid references auth.users(id) on delete set null,
  uses_count  integer not null default 0,
  expires_at  timestamptz,
  created_at  timestamptz not null default now()
);

alter table public.band_invites enable row level security;

-- Band members can read their band's invites
create policy "band_invites_select" on public.band_invites
  for select using (
    exists (
      select 1 from public.band_members bm
      where bm.band_id = band_invites.band_id
        and bm.user_id = auth.uid()
    )
  );

-- Band members can create invites for their own band
create policy "band_invites_insert" on public.band_invites
  for insert with check (
    exists (
      select 1 from public.band_members bm
      where bm.band_id = band_invites.band_id
        and bm.user_id = auth.uid()
    )
  );

-- Anyone can read a single invite by token (for the /invite/[token] landing page)
-- Note: we expose token lookup through a service-role API route, not direct RLS.

-- ─── Auto-create profile on new user sign-up ─────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Profile row is created here with a placeholder username.
  -- The user picks a real username during onboarding and we update it then.
  -- We skip insert if user_metadata already has a username (rare but possible).
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'username',
      'user_' || replace(new.id::text, '-', '')
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Drop and recreate to be idempotent
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─── Track metadata columns (added for rename + icon/color picker) ────────────
-- Run via Supabase dashboard → SQL editor if the table already exists.

alter table public.tracks
  add column if not exists display_name text,           -- user-editable label
  add column if not exists icon_emoji   text default '🎵',
  add column if not exists icon_color   text default '#0d0d1f';
