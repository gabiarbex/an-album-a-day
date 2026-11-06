-- Album-a-Day product funnel.
-- Run server-side/admin only. public.product_events is intentionally not readable by browser roles.

with visitor_steps as (
  select
    visitor_id,
    min(created_at) filter (where event_name='page_view') as visited_at,
    min(created_at) filter (where event_name='pick_shown') as picked_at,
    min(created_at) filter (where event_name='spotify_clicked') as spotify_at,
    min(created_at) filter (where event_name='diary_saved') as saved_at,
    min(created_at) filter (where event_name='listening_completed') as completed_at,
    min(created_at) filter (where event_name='return_visit') as returned_at,
    min(created_at) filter (where event_name='sign_in_completed') as signed_in_at,
    min(created_at) filter (where event_name='supporter_checkout_opened') as checkout_at,
    min(created_at) filter (where event_name='supporter_active') as supporter_at
  from public.product_events
  where created_at >= now() - interval '30 days'
  group by visitor_id
),
counts as (
  select
    count(*) filter (where visited_at is not null) as visitors,
    count(*) filter (where picked_at is not null) as picked,
    count(*) filter (where spotify_at is not null) as spotify,
    count(*) filter (where saved_at is not null) as saved,
    count(*) filter (where completed_at is not null) as completed,
    count(*) filter (where returned_at is not null) as returned,
    count(*) filter (where signed_in_at is not null) as signed_in,
    count(*) filter (where checkout_at is not null) as checkout,
    count(*) filter (where supporter_at is not null) as supporter
  from visitor_steps
)
select
  visitors,
  picked,
  round(100.0*picked/nullif(visitors,0),1) as visit_to_pick_pct,
  spotify,
  round(100.0*spotify/nullif(picked,0),1) as pick_to_spotify_pct,
  saved,
  round(100.0*saved/nullif(picked,0),1) as pick_to_save_pct,
  completed,
  round(100.0*completed/nullif(picked,0),1) as pick_to_complete_pct,
  returned,
  round(100.0*returned/nullif(visitors,0),1) as return_visitor_pct,
  signed_in,
  round(100.0*signed_in/nullif(visitors,0),1) as visit_to_sign_in_pct,
  checkout,
  supporter,
  round(100.0*supporter/nullif(visitors,0),2) as visit_to_supporter_pct
from counts;

-- Daily activity trend:
-- select date_trunc('day',created_at) as day,event_name,count(*) as events,count(distinct visitor_id) as visitors
-- from public.product_events
-- where created_at >= now() - interval '30 days'
-- group by 1,2 order by 1,2;
