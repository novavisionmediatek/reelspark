import { useEffect, useRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { youtubeEmbedHtml } from './youtubeEmbedHtml';
import {
  INSTAGRAM_EXTRA_HEIGHT_PX,
  INSTAGRAM_HEADER_PX,
  INSTAGRAM_MASK_BOTTOM_HEIGHT_PX,
  INSTAGRAM_MASK_BOTTOM_OPAQUE_PX,
  INSTAGRAM_MASK_TOP_HEIGHT_PX,
  INSTAGRAM_MASK_TOP_OPAQUE_PX,
  INSTAGRAM_SCALE,
  instagramReelEmbedSrc,
} from './instagramEmbedHtml';

export interface VideoPlayerProps {
  platform: 'youtube' | 'instagram';
  videoId: string;
  playing: boolean;
  // YouTube only: whether the reel should be silent. Browsers block
  // autoplay-with-sound unless the page already saw a user gesture, so every
  // reel mounts muted and this is how the app's speaker toggle turns sound on
  // without restarting the clip (see the `muted`-changed effect below).
  muted?: boolean;
  onEnded?: () => void;
  // YouTube only: fires once the embed confirms real playback has begun (not
  // just that the iframe mounted) — see `youtubeEmbedHtml.ts`'s 'playing'
  // postMessage. Lets the caller keep its own poster up over the iframe's
  // brief load/buffer window instead of exposing YouTube's own loading state.
  onStarted?: () => void;
  style?: StyleProp<ViewStyle>;
}

// The player is a DOM <iframe>. YouTube reuses the shared IFrame-API HTML via
// srcDoc (origin = this page's origin); Instagram loads its /embed/ page directly
// (a nested srcDoc frame, or a CSS-transformed iframe on mobile, stopped IG
// playing on tap) and hides IG's chrome with plain layout offsets.
export function VideoPlayer({ platform, videoId, playing, muted = true, onEnded, onStarted, style }: VideoPlayerProps) {
  const isYouTube = platform === 'youtube';
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!playing || !isYouTube) return;
    function onMessage(e: MessageEvent) {
      if (e.data === 'ended') onEnded?.();
      else if (e.data === 'playing') onStarted?.();
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [playing, isYouTube, onEnded, onStarted]);

  // Only the initial mute state is baked into the iframe's srcDoc (below) —
  // reacting to `muted` here and posting to the live player instead means
  // toggling sound doesn't reload (and restart) the clip.
  useEffect(() => {
    if (!playing || !isYouTube) return;
    iframeRef.current?.contentWindow?.postMessage(muted ? 'mute' : 'unmute', '*');
  }, [playing, isYouTube, muted]);

  // Frozen at the moment playback starts (each scroll-in is a fresh iframe,
  // since `playing` going false unmounts it below) so later `muted` changes
  // flow through the postMessage effect above instead of regenerating srcDoc.
  const initialMutedRef = useRef(muted);
  const wasPlayingRef = useRef(false);
  if (playing && !wasPlayingRef.current) initialMutedRef.current = muted;
  wasPlayingRef.current = playing;

  if (!playing) return null;

  if (isYouTube) {
    return (
      <View style={[styles.fill, style]}>
        <iframe
          ref={iframeRef}
          title="YouTube video player"
          srcDoc={youtubeEmbedHtml(videoId, window.location.origin, initialMutedRef.current)}
          style={{ width: '100%', height: '100%', border: '0', display: 'block', backgroundColor: '#000' }}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      </View>
    );
  }

  // Instagram: its /embed/ page has no chromeless/API mode, so we clip it and
  // offset the iframe with plain layout (no CSS transform — that breaks touch
  // taps on mobile). The iframe is rendered INSTAGRAM_SCALE times wider than the
  // clip so IG's media area grows to fill the frame's height, pushing IG's
  // header off the top and its footer off the bottom; the extra width spills
  // evenly past both sides and is cropped. IG can't autoplay and its centre play
  // button is inside its own cross-origin document — one tap on it starts the reel.
  return (
    <View style={[styles.fill, style]}>
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#000' }}>
        <iframe
          title="Instagram video player"
          src={instagramReelEmbedSrc(videoId)}
          scrolling="no"
          style={{
            position: 'absolute',
            left: `${(1 - INSTAGRAM_SCALE) * 50}%`,
            top: `-${INSTAGRAM_HEADER_PX * INSTAGRAM_SCALE}px`,
            width: `${INSTAGRAM_SCALE * 100}%`,
            height: `calc(${INSTAGRAM_SCALE * 100}% + ${INSTAGRAM_EXTRA_HEIGHT_PX}px)`,
            border: '0',
            display: 'block',
            background: '#000',
          }}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
        {/* Top + bottom scrim "padding", same as the YouTube embed's #mask-top /
            #mask-bottom: opaque for OPAQUE px, then fading out. Top gives the
            reel some breathing room; bottom also covers IG's footer text. */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: `${INSTAGRAM_MASK_TOP_HEIGHT_PX}px`,
            background: `linear-gradient(to bottom, #000 0, #000 ${INSTAGRAM_MASK_TOP_OPAQUE_PX}px, rgba(0,0,0,0) 100%)`,
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: `${INSTAGRAM_MASK_BOTTOM_HEIGHT_PX}px`,
            background: `linear-gradient(to top, #000 0, #000 ${INSTAGRAM_MASK_BOTTOM_OPAQUE_PX}px, rgba(0,0,0,0) 100%)`,
            pointerEvents: 'none',
          }}
        />
      </div>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', overflow: 'hidden' },
});
