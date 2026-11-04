-- Album-a-Day account sync schema
-- Supabase Auth owns identities. This table stores only app sync state.

create table if not exists public.user_sync_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  diary jsonb not null default '[]'::jsonb,
  deleted_diary_keys jsonb not null default '[]'::jsonb,
  seen_keys jsonb not null default '[]'::jsonb,
  recent_artists jsonb not null default '[]'::jsonb,
  pick_days jsonb not null default '[]'::jsonb,
  lastfm_profile jsonb,
  schema_version integer not null default 1,
  updated_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.user_sync_state enable row level security;

drop policy if exists "users read own album state" on public.user_sync_state;
create policy "users read own album state"
on public.user_sync_state
for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "users insert own album state" on public.user_sync_state;
create policy "users insert own album state"
on public.user_sync_state
for insert
to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "users update own album state" on public.user_sync_state;
create policy "users update own album state"
on public.user_sync_state
for update
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "users delete own album state" on public.user_sync_state;
create policy "users delete own album state"
on public.user_sync_state
for delete
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

grant select, insert, update, delete on public.user_sync_state to authenticated;
revoke all on public.user_sync_state from anon;

comment on table public.user_sync_state is
  'Optional Album-a-Day cross-device sync. Raw Last.fm CSV files are never stored here.';
