import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Avatar } from './Avatar';
import { colors, fonts, radius, spacing } from '../theme/tokens';
import { useAuth } from '../lib/AuthProvider';
import { useAddComment, useComments, useDeleteComment } from '../hooks/useComments';
import type { VideoComment } from '../types/database';

interface CommentsSheetProps {
  videoId: string;
  visible: boolean;
  onClose: () => void;
  // Called after a comment is added / removed so the caller can keep the reel's
  // comment counter in sync without refetching the feed.
  onCountDelta: (delta: number) => void;
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

export function CommentsSheet({ videoId, visible, onClose, onCountDelta }: CommentsSheetProps) {
  const { session } = useAuth();
  const myId = session?.user?.id;
  const [draft, setDraft] = useState('');

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useComments(
    videoId,
    visible,
  );
  const addComment = useAddComment(videoId);
  const deleteComment = useDeleteComment(videoId);

  const comments = data?.pages.flat() ?? [];

  const submit = useCallback(() => {
    const body = draft.trim();
    if (!body || addComment.isPending) return;
    addComment.mutate(body, {
      onSuccess: () => {
        setDraft('');
        onCountDelta(1);
      },
    });
  }, [draft, addComment, onCountDelta]);

  const remove = useCallback(
    (id: string) => {
      deleteComment.mutate(id, { onSuccess: () => onCountDelta(-1) });
    },
    [deleteComment, onCountDelta],
  );

  const renderItem = useCallback(
    ({ item }: { item: VideoComment }) => {
      const name = item.author_name ?? 'Someone';
      const initials = name.slice(0, 2).toUpperCase();
      return (
        <View style={styles.commentRow}>
          <Avatar initials={initials} imageUri={item.author_avatar_url} size={30} />
          <View style={styles.commentBody}>
            <View style={styles.commentMeta}>
              <Text style={styles.commentAuthor}>{name}</Text>
              <Text style={styles.commentTime}>{timeAgo(item.created_at)}</Text>
            </View>
            <Text style={styles.commentText}>{item.body}</Text>
          </View>
          {item.user_id === myId ? (
            <Pressable
              onPress={() => remove(item.id)}
              style={styles.commentDelete}
              accessibilityLabel="Delete comment"
              hitSlop={8}
            >
              <Feather name="trash-2" size={14} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      );
    },
    [myId, remove],
  );

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close comments" />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title}>
            Comments{comments.length ? ` · ${comments.length}` : ''}
          </Text>
          <Pressable onPress={onClose} accessibilityLabel="Close comments" hitSlop={8}>
            <Feather name="x" size={20} color={colors.text} />
          </Pressable>
        </View>

        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.pink} />
          </View>
        ) : isError ? (
          <View style={styles.centered}>
            <Text style={styles.muted}>Couldn't load comments.</Text>
          </View>
        ) : comments.length === 0 ? (
          <View style={styles.centered}>
            <Text style={styles.muted}>No comments yet — be the first.</Text>
          </View>
        ) : (
          <FlatList
            data={comments}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            onEndReachedThreshold={0.6}
            onEndReached={() => {
              if (hasNextPage && !isFetchingNextPage) fetchNextPage();
            }}
            ListFooterComponent={
              isFetchingNextPage ? (
                <ActivityIndicator color={colors.pink} style={{ marginVertical: spacing.md }} />
              ) : null
            }
          />
        )}

        <View style={styles.inputRow}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Add a comment…"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            multiline
            maxLength={1000}
            onSubmitEditing={submit}
            blurOnSubmit
          />
          <Pressable
            onPress={submit}
            disabled={!draft.trim() || addComment.isPending}
            style={[styles.sendBtn, (!draft.trim() || addComment.isPending) && styles.sendBtnDisabled]}
            accessibilityLabel="Post comment"
          >
            <Feather name="send" size={16} color="#fff" />
          </Pressable>
        </View>
        {addComment.isError ? (
          <Text style={styles.error}>Couldn't post that comment. Try again.</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '72%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    paddingBottom: spacing.md,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginTop: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { color: colors.text, fontFamily: fonts.displaySemibold, fontSize: 15 },
  centered: { flex: 1, padding: spacing['2xl'], alignItems: 'center', justifyContent: 'center' },
  muted: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 13 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.lg },
  commentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  commentBody: { flex: 1, gap: 2 },
  commentMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  commentAuthor: { color: colors.text, fontFamily: fonts.bodySemibold, fontSize: 13 },
  commentTime: { color: colors.textMuted, fontFamily: fonts.mono, fontSize: 10 },
  commentText: { color: '#EDEDF2', fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  commentDelete: { padding: 4 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 13,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.pink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  error: {
    color: colors.danger,
    fontFamily: fonts.body,
    fontSize: 11,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
  },
});
