-- Likes + comments on feed videos.
--
-- Any authenticated user can like/unlike any approved video and post comments
-- on it; likes and comments are readable by every authenticated user. Denormalised
-- `like_count` / `comment_count` counters live on `videos` (kept in sync by
-- triggers) so the feed RPC returns them with no extra join — `get_feed_page`
-- already does `select *` from `public.videos`, so the new columns flow through
-- automatically.

-- =========================================================
-- counters on videos
-- =========================================================
alter table public.videos add column if not exists like_count integer not null default 0;
alter table public.videos add column if not exists comment_count integer not null default 0;

-- =========================================================
-- video_likes — one row per (video, user)
-- =========================================================
create table public.video_likes (
  video_id uuid not null references public.videos (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (video_id, user_id)
);

create index video_likes_user_idx on public.video_likes (user_id);
create index video_likes_video_idx on public.video_likes (video_id);

alter table public.video_likes enable row level security;

create policy "likes are readable by any authenticated user"
  on public.video_likes for select
  to authenticated
  using (
    exists (
      select 1 from public.videos v
      where v.id = video_id
        and (
          (v.status = 'approved' and v.is_deleted = false)
          or v.submitted_by = auth.uid()
          or public.is_admin()
        )
    )
  );

create policy "users add their own like"
  on public.video_likes for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "users remove their own like"
  on public.video_likes for delete
  to authenticated
  using (user_id = auth.uid());

-- like_count maintenance
create function public.handle_video_like_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.videos set like_count = like_count + 1 where id = new.video_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.videos set like_count = greatest(like_count - 1, 0) where id = old.video_id;
    return old;
  end if;
  return null;
end;
$$;

create trigger video_likes_count_insert
  after insert on public.video_likes
  for each row execute function public.handle_video_like_change();

create trigger video_likes_count_delete
  after delete on public.video_likes
  for each row execute function public.handle_video_like_change();

-- Toggle helper: likes the video if not already liked, unlikes it otherwise.
-- Returns the resulting liked state (true = now liked).
create function public.toggle_video_like(p_video_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_liked boolean;
begin
  -- Only allow liking a video the caller is actually allowed to see.
  if not exists (
    select 1 from public.videos v
    where v.id = p_video_id
      and (
        (v.status = 'approved' and v.is_deleted = false)
        or v.submitted_by = auth.uid()
        or public.is_admin()
      )
  ) then
    raise exception 'Video not found';
  end if;

  if exists (
    select 1 from public.video_likes
    where video_id = p_video_id and user_id = auth.uid()
  ) then
    delete from public.video_likes
    where video_id = p_video_id and user_id = auth.uid();
    v_liked := false;
  else
    insert into public.video_likes (video_id, user_id)
    values (p_video_id, auth.uid())
    on conflict (video_id, user_id) do nothing;
    v_liked := true;
  end if;

  return v_liked;
end;
$$;

grant execute on function public.toggle_video_like(uuid) to authenticated;

-- =========================================================
-- video_comments
-- =========================================================
create table public.video_comments (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index video_comments_feed_idx
  on public.video_comments (video_id, created_at desc)
  where is_deleted = false;

alter table public.video_comments enable row level security;

create trigger video_comments_set_updated_at
  before update on public.video_comments
  for each row execute function public.set_updated_at();

create policy "comments are readable by any authenticated user"
  on public.video_comments for select
  to authenticated
  using (
    is_deleted = false
    and exists (
      select 1 from public.videos v
      where v.id = video_id
        and (
          (v.status = 'approved' and v.is_deleted = false)
          or v.submitted_by = auth.uid()
          or public.is_admin()
        )
    )
  );

create policy "users post their own comments"
  on public.video_comments for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "users edit their own comments"
  on public.video_comments for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "users delete their own comments, admins delete any"
  on public.video_comments for delete
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- comment_count maintenance (respects the is_deleted soft-delete flag)
create function public.handle_video_comment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_deleted = false then
      update public.videos set comment_count = comment_count + 1 where id = new.video_id;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.is_deleted = false then
      update public.videos set comment_count = greatest(comment_count - 1, 0) where id = old.video_id;
    end if;
    return old;
  elsif tg_op = 'UPDATE' then
    if old.is_deleted = false and new.is_deleted = true then
      update public.videos set comment_count = greatest(comment_count - 1, 0) where id = new.video_id;
    elsif old.is_deleted = true and new.is_deleted = false then
      update public.videos set comment_count = comment_count + 1 where id = new.video_id;
    end if;
    return new;
  end if;
  return null;
end;
$$;

create trigger video_comments_count_insert
  after insert on public.video_comments
  for each row execute function public.handle_video_comment_change();

create trigger video_comments_count_delete
  after delete on public.video_comments
  for each row execute function public.handle_video_comment_change();

create trigger video_comments_count_update
  after update on public.video_comments
  for each row execute function public.handle_video_comment_change();

-- =========================================================
-- backfill counters for any rows that predate this migration
-- (no-op on a fresh DB, safe to run either way)
-- =========================================================
update public.videos v
set like_count = coalesce((select count(*) from public.video_likes l where l.video_id = v.id), 0),
    comment_count = coalesce((select count(*) from public.video_comments c where c.video_id = v.id and c.is_deleted = false), 0);
