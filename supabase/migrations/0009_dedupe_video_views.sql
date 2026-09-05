-- Views were counted once per FeedItem mount (in-memory ref in FeedScreen.tsx),
-- so re-watching a video after leaving/re-entering the feed, or on a second
-- visit/session, counted as another view. Track one row per (video, viewer) and
-- only bump the counter the first time a given user watches a given video.

create table public.video_views (
  video_id uuid not null references public.videos (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (video_id, viewer_id)
);

alter table public.video_views enable row level security;

create policy "users read their own view history"
  on public.video_views for select
  using (auth.uid() = viewer_id);

-- No insert/update/delete policies: rows are only ever written by
-- increment_view_count below, which runs as security definer.

-- Returns whether this call actually counted a new view, so the client can
-- avoid optimistically bumping the on-screen count for a repeat viewer.
-- Changing the return type (void -> boolean) requires a drop, not a replace.
drop function public.increment_view_count(uuid);

create function public.increment_view_count(p_video_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_new_view boolean;
begin
  insert into public.video_views (video_id, viewer_id)
  values (p_video_id, auth.uid())
  on conflict (video_id, viewer_id) do nothing;

  v_is_new_view := found;

  if v_is_new_view then
    update public.videos
    set view_count_in_app = view_count_in_app + 1
    where id = p_video_id and status = 'approved' and is_deleted = false;
  end if;

  return v_is_new_view;
end;
$$;

grant execute on function public.increment_view_count(uuid) to authenticated;
