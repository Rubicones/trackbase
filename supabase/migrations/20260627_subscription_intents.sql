-- subscription_intents: capture upgrade interest before billing is built.
-- No payment processed. Used to contact interested users at launch.

create table subscription_intents (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        references auth.users(id) on delete cascade,
  plan       text        not null check (plan in ('band', 'studio')),
  email      text,
  created_at timestamptz default now()
);

alter table subscription_intents enable row level security;

-- Users can log their own intent
create policy "intents_insert_own" on subscription_intents
  for insert with check (auth.uid() = user_id);

-- Users can read their own intents
create policy "intents_select_own" on subscription_intents
  for select using (auth.uid() = user_id);
