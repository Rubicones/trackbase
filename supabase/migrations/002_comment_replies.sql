create table if not exists public.comment_replies (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.track_comments(id) on delete cascade,
  created_by uuid references auth.users(id),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists comment_replies_comment_id_idx on comment_replies(comment_id);
alter table public.comment_replies enable row level security;
create policy "replies_select" on comment_replies for select using (true);
create policy "replies_insert" on comment_replies for insert with check (auth.uid() = created_by);
create policy "replies_delete" on comment_replies for delete using (auth.uid() = created_by);
