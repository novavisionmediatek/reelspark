import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Video } from '../types/database';

const PAGE_SIZE = 10;

export function useFeed() {
  return useInfiniteQuery({
    queryKey: ['feed'],
    queryFn: async ({ pageParam }: { pageParam: { createdAt: string; id: string } | null }) => {
      const { data, error } = await supabase.rpc('get_feed_page', {
        cursor_created_at: pageParam?.createdAt ?? null,
        cursor_id: pageParam?.id ?? null,
        page_size: PAGE_SIZE,
      });
      if (error) throw error;
      const videos = (data ?? []) as Video[];

      // Mark which of this page's videos the signed-in user has already liked,
      // so the heart on each reel renders in the right state on first paint.
      if (videos.length > 0) {
        const { data: userData } = await supabase.auth.getUser();
        const uid = userData.user?.id;
        if (uid) {
          const { data: likes } = await supabase
            .from('video_likes')
            .select('video_id')
            .eq('user_id', uid)
            .in('video_id', videos.map((v) => v.id));
          const likedSet = new Set((likes ?? []).map((l) => l.video_id as string));
          videos.forEach((v) => {
            v.liked_by_me = likedSet.has(v.id);
          });
        }
      }
      return videos;
    },
    initialPageParam: null as { createdAt: string; id: string } | null,
    getNextPageParam: (lastPage) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      const last = lastPage[lastPage.length - 1];
      return { createdAt: last.created_at, id: last.id };
    },
  });
}

// Returns true if this call counted a genuinely new view (i.e. this user
// hasn't watched this video before) so callers can skip an optimistic UI bump
// for repeat viewers.
export async function incrementViewCount(videoId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('increment_view_count', { p_video_id: videoId });
  if (error) {
    console.warn('incrementViewCount failed', error);
    return false;
  }
  return Boolean(data);
}

// Likes/unlikes a video for the current user. Returns the resulting liked state
// (true = now liked) so the caller can reconcile its optimistic UI.
export async function toggleVideoLike(videoId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('toggle_video_like', { p_video_id: videoId });
  if (error) throw error;
  return Boolean(data);
}
