import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { VideoComment } from '../types/database';

const PAGE_SIZE = 20;

// PostgREST returns the embedded profile either as an object or (defensively) an
// array depending on how it resolves the relationship — normalise both.
type RawProfile = { display_name: string | null; avatar_url: string | null };
interface RawComment {
  id: string;
  video_id: string;
  user_id: string;
  body: string;
  created_at: string;
  profiles: RawProfile | RawProfile[] | null;
}

function normalize(row: RawComment): VideoComment {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return {
    id: row.id,
    video_id: row.video_id,
    user_id: row.user_id,
    body: row.body,
    created_at: row.created_at,
    author_name: profile?.display_name ?? null,
    author_avatar_url: profile?.avatar_url ?? null,
  };
}

const SELECT = 'id, video_id, user_id, body, created_at, profiles(display_name, avatar_url)';

export function useComments(videoId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['comments', videoId],
    enabled,
    queryFn: async ({ pageParam }: { pageParam: string | null }) => {
      let query = supabase
        .from('video_comments')
        .select(SELECT)
        .eq('video_id', videoId)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);
      if (pageParam) query = query.lt('created_at', pageParam);
      const { data, error } = await query;
      if (error) throw error;
      return ((data ?? []) as unknown as RawComment[]).map(normalize);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return lastPage[lastPage.length - 1].created_at;
    },
  });
}

export function useAddComment(videoId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: string) => {
      const trimmed = body.trim();
      if (!trimmed) throw new Error('Comment is empty');
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error('You must be signed in to comment');
      const { data, error } = await supabase
        .from('video_comments')
        .insert({ video_id: videoId, user_id: uid, body: trimmed })
        .select(SELECT)
        .single();
      if (error) throw error;
      return normalize(data as unknown as RawComment);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', videoId] });
    },
  });
}

export function useDeleteComment(videoId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (commentId: string) => {
      const { error } = await supabase
        .from('video_comments')
        .update({ is_deleted: true })
        .eq('id', commentId);
      if (error) throw error;
      return commentId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', videoId] });
    },
  });
}
