create table if not exists public.product_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  event_name text not null,
  visitor_id text not null,
  session_id text not null,
  page_path text not null default '/',
  properties jsonb not null default '{}'::jsonb,
  constraint product_events_event_name_check check (
    event_name in (
      'page_view','return_visit','pick_requested','pick_shown','spotify_clicked',
      'diary_saved','listening_completed','rating_submitted','diary_opened',
      'account_opened','sign_in_started','sign_in_completed',
      'supporter_teaser_opened','supporter_checkout_opened','supporter_active',
      'wrapped_opened'
    )
  ),
  constraint product_events_visitor_id_check check (
    char_length(visitor_id)=36 and visitor_id ~* '^[0-9a-f-]{36}$'
  ),
  constraint product_events_session_id_check check (
    char_length(session_id)=36 and session_id ~* '^[0-9a-f-]{36}$'
  ),
  constraint product_events_page_path_check check (char_length(page_path) between 1 and 160),
  constraint product_events_properties_check check (
    jsonb_typeof(properties)='object' and octet_length(properties::text) <= 2048
  )
);

comment on table public.product_events is
  'Privacy-light Album-a-Day product funnel events. No email, account ID, diary notes, or free-text mood notes.';

create index if not exists product_events_created_at_idx
  on public.product_events(created_at desc);

create index if not exists product_events_event_name_created_at_idx
  on public.product_events(event_name, created_at desc);

create index if not exists product_events_visitor_created_at_idx
  on public.product_events(visitor_id, created_at desc);

alter table public.product_events enable row level security;

revoke all on table public.product_events from anon, authenticated;
grant insert on table public.product_events to anon, authenticated;

drop policy if exists "bounded anonymous product event insert" on public.product_events;
create policy "bounded anonymous product event insert"
  on public.product_events
  for insert
  to anon, authenticated
  with check (
    event_name in (
      'page_view','return_visit','pick_requested','pick_shown','spotify_clicked',
      'diary_saved','listening_completed','rating_submitted','diary_opened',
      'account_opened','sign_in_started','sign_in_completed',
      'supporter_teaser_opened','supporter_checkout_opened','supporter_active',
      'wrapped_opened'
    )
    and char_length(visitor_id)=36
    and char_length(session_id)=36
    and char_length(page_path) between 1 and 160
    and jsonb_typeof(properties)='object'
    and octet_length(properties::text) <= 2048
  );