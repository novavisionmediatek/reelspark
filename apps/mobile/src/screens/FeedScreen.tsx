import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewToken,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { Avatar } from '../components/Avatar';
import { PlatformChip } from '../components/PlatformChip';
import { VideoPlayer } from '../components/VideoPlayer';
import { colors, fonts, radius, spacing } from '../theme/tokens';
import { useResponsive } from '../theme/responsive';
import { bestYtThumbnail, ytThumbnailFallback } from '../lib/ytThumb';
import { useFeed, incrementViewCount } from '../hooks/useFeed';
import type { Video } from '../types/database';

// Deterministic-looking placeholder gradient per video, shown behind the player
// and whenever a submission has no real thumbnail art (e.g. Instagram, until the
// oEmbed Edge Function exists — YouTube ones use the real thumbnail_url).
const PLACEHOLDER_GRADIENTS: [string, string][] = [
  [colors.orange, colors.pink],
  [colors.magenta, colors.deepPurple],
  [colors.coral, colors.purple],
];

function gradientFor(id: string) {
  const index = id.charCodeAt(0) % PLACEHOLDER_GRADIENTS.length;
  return PLACEHOLDER_GRADIENTS[index];
}

interface FeedItemProps {
  video: Video;
  // Whether this item is the one currently snapped into view. Off-screen items
  // must stop playing so we never have two videos with audio at once.
  isActive: boolean;
  itemHeight: number;
  // Desktop shows a "scroll / arrow keys" hint instead of the swipe hint.
  desktop: boolean;
  // YouTube only — shared across every item so unmuting once keeps sound on
  // for the rest of the feed. Lifted to FeedScreen so it's a single source
  // of truth instead of resetting per item.
  soundOn: boolean;
  onToggleSound: () => void;
}

function FeedItem({ video, isActive, itemHeight, desktop, soundOn, onToggleSound }: FeedItemProps) {
  // Instagram's /embed/ is a cross-origin iframe: it can't autoplay and we can't
  // script it or hide its centre play button. So we just mount the reel as soon
  // as it's the active item and let the viewer tap IG's own button once to
  // start it — no app poster, no app play button, no chrome layered on top.
  const isInstagram = video.platform === 'instagram';
  const [playing, setPlaying] = useState(false);
  // YouTube only: flips true once the embed actually confirms a PLAYING state
  // (not just "mounted") — mounting starts instantly, but the iframe itself
  // still takes a beat to load, during which YouTube shows its own poster +
  // branded play button. Our nicer blurred poster stays layered on top of the
  // iframe (masking that flash) until this fires, then steps aside.
  const [started, setStarted] = useState(false);
  const [views, setViews] = useState(video.view_count_in_app);
  const [gradientFrom, gradientTo] = gradientFor(video.id);
  const countedView = useRef(false);

  const countView = useCallback(() => {
    if (countedView.current) return;
    countedView.current = true;
    // The server dedupes by (video, viewer): only bump the shown count if this
    // is a genuinely new view for this user, not a re-watch.
    incrementViewCount(video.id).then((isNewView) => {
      if (isNewView) setViews((v) => v + 1);
    });
  }, [video.id]);

  // Autoplay: start as soon as the item scrolls into view, stop as soon as it
  // scrolls out. A manual pause (tap while active) isn't overridden by this,
  // since it only re-runs when `isActive` itself flips.
  useEffect(() => {
    setPlaying(isActive);
    if (!isActive) setStarted(false);
  }, [isActive]);

  // Count the view as soon as the item scrolls in and starts autoplaying — for
  // IG we also can't observe the tap inside its cross-origin iframe.
  useEffect(() => {
    if (isActive) countView();
  }, [isActive, countView]);

  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      if (!p) countView();
      return !p;
    });
  }, [countView]);

  const handleEnded = useCallback(() => {
    setPlaying(false);
  }, []);

  const handleStarted = useCallback(() => setStarted(true), []);

  // YouTube: our poster + tap-to-play. Instagram: the reel (IG's own iframe, with
  // IG's own poster + button) is mounted whenever the item is active.
  const showReel = isInstagram ? isActive : isActive && playing;
  // Whether OUR chrome (poster/dim/"For You") should mask the player. For
  // Instagram this is just "not active" (no app poster ever, per above). For
  // YouTube it stays masked through the mount+load window, only clearing once
  // `started` confirms real video frames are on screen.
  const showChrome = isInstagram ? !showReel : !started;

  const initials = (video.author_name ?? '??').slice(0, 2).toUpperCase();

  return (
    <View style={[styles.item, { height: itemHeight }]}>
      <LinearGradient
        colors={[gradientFrom, colors.background, gradientTo]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* The actual player. Mounts (and starts loading/autoplaying) the instant
          the item is active, underneath our poster below — see `showChrome`. */}
      <VideoPlayer
        platform={video.platform}
        videoId={video.platform_video_id}
        playing={showReel}
        muted={!soundOn}
        onEnded={handleEnded}
        onStarted={isInstagram ? undefined : handleStarted}
        style={styles.playerFill}
      />

      {/* Poster art, layered ON TOP of the player (after it in DOM order) so it
          masks YouTube's own loading poster/play-button flash while the iframe
          loads — see `showChrome`. Raw <img> (react-native-web's <Image>
          doesn't reliably honor resizeMode here, and this is a web-only
          build). It's blurred + scaled as a soft backdrop — a given video's
          poster frame can be anything (e.g. a white screen-share), so we don't
          show it sharp. */}
      {showChrome && video.thumbnail_url ? (
        <img
          src={bestYtThumbnail(video.thumbnail_url) ?? video.thumbnail_url}
          alt=""
          draggable={false}
          onError={(e) => {
            const el = e.currentTarget;
            const next = ytThumbnailFallback(video.thumbnail_url, el.src);
            if (next) el.src = next;
          }}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            backgroundColor: '#000',
            filter: 'blur(40px) brightness(0.55) saturate(1.2)',
            transform: 'scale(1.4)',
          }}
        />
      ) : null}

      {/* Stopped/loading-state only: full dim + top scrim + "For You" tag. */}
      {showChrome ? (
        <>
          <View style={styles.posterScrim} pointerEvents="none" />
          <LinearGradient colors={['rgba(0,0,0,0.45)', 'transparent']} style={styles.topGradient} pointerEvents="none" />
          <Text style={styles.forYou}>For You</Text>
        </>
      ) : null}

      {/* Bottom scrim stays up during playback so the creator/caption row below
          it is legible over the video. */}
      <LinearGradient
        colors={['transparent', 'rgba(9,9,11,0.95)']}
        style={styles.bottomGradient}
        pointerEvents="none"
      />

      {/* No app play button. YouTube autoplays on scroll-in; this fallback only
          shows if that autoplay got blocked (e.g. no user gesture yet), and the
          player's own tap layer handles pause/resume once it's running.
          Instagram: the reel is already mounted, so the single tap lands on
          IG's own control. */}
      {showChrome && !isInstagram ? (
        <Pressable style={StyleSheet.absoluteFill} onPress={togglePlay} accessibilityLabel="Play video" />
      ) : null}

      {/* Action rail + creator/caption row stay visible while the reel plays
          (`box-none` so only the buttons take taps — the rest passes through to
          the video's own pause layer). */}
      <View style={styles.rail} pointerEvents="box-none">
        <Pressable style={styles.railBtn} accessibilityLabel="Report video">
          <Feather name="flag" size={18} color="#fff" />
        </Pressable>
        <Pressable style={styles.railBtn} accessibilityLabel="Share video">
          <Feather name="share-2" size={18} color="#fff" />
        </Pressable>
        {/* YouTube only — every reel autoplays muted (browsers block
            autoplay-with-sound with no prior gesture); this turns sound on for
            the current and all future reels. Instagram's own iframe audio
            isn't reachable from here, so the toggle is hidden for it. */}
        {!isInstagram ? (
          <Pressable style={styles.railBtn} accessibilityLabel={soundOn ? 'Mute video' : 'Unmute video'} onPress={onToggleSound}>
            <Feather name={soundOn ? 'volume-2' : 'volume-x'} size={18} color="#fff" />
          </Pressable>
        ) : null}
        <View style={styles.railCount}>
          <Text style={styles.railCountNumber}>{views}</Text>
          <Text style={styles.railCountLabel}>views</Text>
        </View>
      </View>

      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.creatorRow}>
          <Avatar initials={initials} size={26} />
          <Text style={styles.creatorName}>{video.author_name ?? 'Unknown creator'}</Text>
          <PlatformChip platform={video.platform} />
        </View>
        <Text style={styles.caption} numberOfLines={2}>
          {video.title ?? 'Untitled submission'}
        </Text>
        <Text style={styles.swipeHint}>
          {desktop ? 'Scroll or press ↑ ↓ for next' : '↑ Swipe up for next'}
        </Text>
      </View>
    </View>
  );
}

const SOUND_PREF_KEY = 'reelspark:feedSoundOn';

export function FeedScreen() {
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useFeed();
  const { feedDesktop } = useResponsive();
  const isFocused = useIsFocused();

  // Shared across every reel: unmuting once keeps sound on as you keep
  // scrolling, and the choice survives a reload.
  const [soundOn, setSoundOn] = useState(() => {
    try {
      return localStorage.getItem(SOUND_PREF_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleSound = useCallback(() => {
    setSoundOn((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SOUND_PREF_KEY, next ? '1' : '0');
      } catch {
        /* storage unavailable — keep the in-memory value for this session */
      }
      return next;
    });
  }, []);

  // Each feed item is exactly as tall as the visible feed area (the scene minus
  // the bottom tab bar, or the full height beside the left rail). Seeded from the
  // window height so the list always renders, then corrected by onLayout — the
  // list is keyed on this value so it remounts cleanly when it changes, keeping
  // item height === snapToInterval === getItemLayout length on every device.
  const [areaHeight, setAreaHeight] = useState(() => Math.round(Dimensions.get('window').height));
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    setAreaHeight((prev) => (Math.abs(prev - h) <= 1 ? prev : h));
  }, []);

  // On desktop the feed is a centered 9:16 card, not full-bleed: leave vertical
  // breathing room, cap the width, then lock the height to a true 9:16 so the
  // reel is never cropped on wide monitors. Elsewhere the card is the whole area.
  const maxCardHeight = feedDesktop ? Math.max(320, areaHeight - spacing.xl * 2) : areaHeight;
  const cardWidth = feedDesktop ? Math.min(Math.round(maxCardHeight * 9 / 16), 460) : undefined;
  const cardHeight = feedDesktop && cardWidth ? Math.round(cardWidth * 16 / 9) : areaHeight;

  const videos = data?.pages.flat() ?? [];
  const videoCount = videos.length;

  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(0);
  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  const listRef = useRef<FlatList<Video>>(null);

  // Keep the active id/index in a ref-stable callback (FlatList warns if this changes).
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((token) => token.isViewable);
    if (first?.item) setActiveId((first.item as Video).id);
    if (first && first.index != null) setActiveIndex(first.index);
  });
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 80 });

  // Desktop navigation: the playing <iframe> swallows wheel + key events, so we
  // drive the list by index instead of relying on native paging.
  const goBy = useCallback(
    (delta: number) => {
      const target = Math.max(0, Math.min(activeIndexRef.current + delta, videoCount - 1));
      if (target === activeIndexRef.current) return;
      listRef.current?.scrollToIndex({ index: target, animated: true });
      if (target >= videoCount - 2 && hasNextPage && !isFetchingNextPage) fetchNextPage();
    },
    [videoCount, hasNextPage, isFetchingNextPage, fetchNextPage],
  );

  // Mouse wheel → one reel per gesture (attached natively so preventDefault works).
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = stageRef.current;
    if (!feedDesktop || !node) return;
    let accum = 0;
    let locked = false;
    let timer = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (locked) return;
      accum += e.deltaY;
      if (Math.abs(accum) < 24) return;
      const dir = accum > 0 ? 1 : -1;
      accum = 0;
      locked = true;
      goBy(dir);
      timer = window.setTimeout(() => {
        locked = false;
      }, 450);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      node.removeEventListener('wheel', onWheel);
      window.clearTimeout(timer);
    };
  }, [feedDesktop, goBy]);

  // Keyboard navigation while the Feed screen is on top.
  useEffect(() => {
    if (!feedDesktop || !isFocused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'j' || e.key === ' ') {
        e.preventDefault();
        goBy(1);
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'k') {
        e.preventDefault();
        goBy(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [feedDesktop, isFocused, goBy]);

  const renderItem = useCallback(
    ({ item }: { item: Video }) => (
      <FeedItem
        video={item}
        // Tab navigators keep this screen mounted when another tab is on top,
        // so gate on focus too — otherwise the active reel keeps autoplaying
        // (and counting views) in the background after navigating away.
        isActive={isFocused && item.id === activeId}
        itemHeight={cardHeight}
        desktop={feedDesktop}
        soundOn={soundOn}
        onToggleSound={toggleSound}
      />
    ),
    [activeId, cardHeight, feedDesktop, soundOn, toggleSound, isFocused],
  );

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.pink} />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>Couldn't load the feed. Pull to try again.</Text>
      </View>
    );
  }

  if (videos.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>No videos yet</Text>
        <Text style={styles.emptyText}>Be the first to submit a Short or Reel — approved submissions show up here.</Text>
      </View>
    );
  }

  const list = (
    <FlatList
      ref={listRef}
      // Remount cleanly when the feed area resizes so scroll offsets can't
      // drift out of sync with the new item height.
      key={`feed-${cardHeight}`}
      style={styles.list}
      data={videos}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      pagingEnabled
      showsVerticalScrollIndicator={false}
      decelerationRate="fast"
      snapToInterval={cardHeight}
      getItemLayout={(_, index) => ({ length: cardHeight, offset: cardHeight * index, index })}
      onViewableItemsChanged={onViewableItemsChanged.current}
      viewabilityConfig={viewabilityConfig.current}
      onScrollToIndexFailed={({ index }) => {
        setTimeout(() => listRef.current?.scrollToIndex({ index, animated: true }), 60);
      }}
      onEndReachedThreshold={1.5}
      onEndReached={() => {
        if (hasNextPage && !isFetchingNextPage) fetchNextPage();
      }}
    />
  );

  if (!feedDesktop) {
    return (
      <View style={styles.screen} onLayout={onLayout}>
        {list}
      </View>
    );
  }

  const atStart = activeIndex <= 0;
  const atEnd = activeIndex >= videoCount - 1 && !hasNextPage;

  return (
    <View style={[styles.screen, styles.screenDesktop]} onLayout={onLayout}>
      <div ref={stageRef} style={stageStyle}>
        <View style={[styles.card, { width: cardWidth, height: cardHeight }]}>{list}</View>
        <View style={styles.chevronColumn}>
          <Pressable
            onPress={() => goBy(-1)}
            disabled={atStart}
            style={[styles.chevronBtn, atStart && styles.chevronBtnDisabled]}
            accessibilityLabel="Previous reel"
          >
            <Feather name="chevron-up" size={22} color="#fff" />
          </Pressable>
          <Pressable
            onPress={() => goBy(1)}
            disabled={atEnd}
            style={[styles.chevronBtn, atEnd && styles.chevronBtnDisabled]}
            accessibilityLabel="Next reel"
          >
            <Feather name="chevron-down" size={22} color="#fff" />
          </Pressable>
        </View>
      </div>
    </View>
  );
}

const stageStyle: CSSProperties = {
  display: 'flex',
  flex: 1,
  width: '100%',
  height: '100%',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: spacing.xl,
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, overflow: 'hidden' },
  screenDesktop: { alignItems: 'center', justifyContent: 'center' },
  list: { flex: 1 },
  card: {
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: colors.border,
  },
  chevronColumn: { gap: spacing.md },
  chevronBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronBtnDisabled: { opacity: 0.3 },
  centered: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  emptyTitle: { color: colors.text, fontFamily: fonts.displaySemibold, fontSize: 18 },
  emptyText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 13, textAlign: 'center' },
  item: { width: '100%', overflow: 'hidden' },
  posterScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(9,9,11,0.18)' },
  playerFill: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  topGradient: { position: 'absolute', top: 0, left: 0, right: 0, height: 130 },
  bottomGradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 280 },
  forYou: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    color: colors.textMuted,
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  rail: { position: 'absolute', right: 14, bottom: 100, alignItems: 'center', gap: 18 },
  railBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  railCount: { alignItems: 'center' },
  railCountNumber: { color: colors.text, fontFamily: fonts.monoSemibold, fontSize: 12 },
  railCountLabel: { color: colors.textMuted, fontFamily: fonts.mono, fontSize: 10 },
  overlay: { position: 'absolute', left: 18, right: 74, bottom: 40, gap: 8 },
  creatorRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  creatorName: { color: colors.text, fontFamily: fonts.bodySemibold, fontSize: 14 },
  caption: { color: '#EDEDF2', fontFamily: fonts.body, fontSize: 13, lineHeight: 19 },
  swipeHint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 11 },
});
