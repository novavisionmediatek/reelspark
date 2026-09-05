# Mobile app — Vite + react-native-web

This app was migrated off Expo. It now runs in the browser only:

- **Bundler/dev server:** Vite (`npm run dev`, port 5174). No Metro, no Expo CLI.
- **Runtime:** `react-native` is aliased to `react-native-web` in `vite.config.ts`.
- **Removed Expo modules** are replaced by small local shims in `src/shims/`:
  - `expo-linear-gradient` → CSS `linear-gradient` on a View
  - `expo-image-picker` → hidden `<input type="file">`
  - `@expo/vector-icons` (`Feather`, `Ionicons`) → inline SVG, only the glyphs in use
- **Fonts:** `src/fonts.css` defines `@font-face`s (named to match `src/theme/tokens.ts`) from the `@fontsource/*` packages.
- **Env:** Vite vars — `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (see `.env.example`).
- **Entry:** `index.html` → `src/main.tsx` → `App.tsx`.

There are no native (iOS/Android) targets anymore. Platform-specific files can
still use the `.web.tsx` suffix, but everything here is the web build.

## Responsive layout

`src/theme/responsive.ts` exports `useResponsive()` (built on `useWindowDimensions`,
so it re-renders on resize). Breakpoints: phone `<768`, `sidebar` (left nav) `≥1000`,
desktop `≥1024`, wide `≥1440`.

- **Nav:** `MainTabNavigator` uses a bottom tab bar below 1000px and a left nav
  rail (`material`, `tabBarPosition: 'left'`) at `≥1000` (`sidebarNav`).
- **Feed:** full-bleed on phone/tablet (`<1000px`); on desktop (`feedDesktop`,
  `≥1000px`) it's a centered 9:16 phone-frame card (`width` capped at 460, height
  locked to `width*16/9`) on the dark canvas with an up/down chevron column
  beside it — the reel is never cropped on wide monitors. `FeedScreen` seeds item
  height from the window and corrects it via `onLayout` (list is `key`ed on the
  card height so it remounts, keeping item height === snapToInterval ===
  getItemLayout length). Because the playing `<iframe>` swallows wheel + key
  events, desktop advances the feed by index (`listRef.scrollToIndex`): a stage
  `wheel` listener (one reel per gesture, `preventDefault`s native scroll),
  `keydown` on `window` while the screen `useIsFocused()` (↑/↓, PageUp/PageDown,
  Space, j/k), and the chevron buttons — all via `goBy(±1)`. The YouTube embed
  (`youtubeEmbedHtml.ts`) sizes its player to the **9:16 frame itself** and lets
  YouTube's embed player cover-fit the clip: a true Short fills the frame with no
  crop, a landscape clip centre-crops to fill it. (Sizing the player as a 16:9
  box wider than the frame — the previous approach — made YouTube cover-fit a
  vertical Short to that over-wide box and zoom ~3x, cropping the Short away.)
  **Autoplay:** `FeedItem` sets `playing = isActive` (`FeedScreen.tsx`), so a
  YouTube reel starts as soon as it scrolls into view (`autoplay: 1` +
  `playVideo()` in `onReady`, `youtubeEmbedHtml.ts`) and stops as soon as it
  scrolls out — no tap needed. There is **no app play button**: a full-bleed
  `Pressable` over the poster is only a fallback for when autoplay gets
  blocked (e.g. the browser hasn't seen a user gesture yet); once running, tapping
  the reel itself pauses/resumes it via the embed's `#tap` layer, which does
  **not** re-trigger the `isActive` effect, so a manual pause sticks until the
  item scrolls out and back in. The paused poster is a raw
  `<img>` (RNW `<Image>` ignores `resizeMode` here) using YouTube's 9:16
  `oardefault.jpg` (`lib/ytThumb.ts`), heavily blurred + darkened as a backdrop.
  The creator/caption row, the action rail (flag/share/views) and the bottom
  scrim **stay visible while the reel plays** (`box-none` so only the buttons
  take taps); the full dim, top scrim and "For You" tag show only while stopped.
- **Instagram:** `VideoPlayer` loads `/reel/<id>/embed/` **directly** as an
  `<iframe src>` inside a clipping `<div>` (nesting it in a srcDoc frame gave the
  inner frame an opaque origin and stopped IG playing on tap; a CSS
  `transform: scale()` broke touch taps on mobile the same way). It hides IG's
  chrome with **plain layout**: the iframe is rendered `INSTAGRAM_SCALE`× wider
  than the clip (IG lays its page out to that width so the reel's media grows
  with it), pulled up `INSTAGRAM_HEADER_PX` and made `INSTAGRAM_EXTRA_HEIGHT_PX`
  taller than the clip so IG's header/footer sit outside it; the extra width
  spills evenly past both sides and is cropped. `INSTAGRAM_SCALE` is a
  compromise (1.5) — enough that the reel's framing stays close to Instagram's
  rather than the ~1.9 it takes to physically push IG's footer off the clip;
  `VideoPlayer` then lays the same top + bottom fading scrims the YouTube embed
  uses over the clip (`INSTAGRAM_MASK_TOP_*` / `INSTAGRAM_MASK_BOTTOM_*` in
  `instagramEmbedHtml.ts`): the top strip is header padding, the bottom strip is
  footer padding and stays opaque long enough to hide IG's like/caption/"more on
  Instagram" text.
  IG can't autoplay and its centre play button lives on instagram.com's origin,
  so it can't be scripted or hidden — instead `FeedItem` mounts the IG iframe as
  soon as the item is active (no app poster / play button on top), so a single
  tap lands on IG's own control and its button clears itself once the reel plays.
  The view is counted when an IG item scrolls in (the tap can't be observed
  inside the iframe); IG items have no "ended" event so they don't auto-advance,
  and IG's centre **"Watch again on Instagram"** replay card after a reel ends is
  likewise inside IG's cross-origin iframe and can't be removed from our side —
  only playing the raw `.mp4` avoids it.
- **View counting:** `view_count_in_app` (on `videos`) is bumped through the
  `increment_view_count` RPC (`supabase/migrations/0009_dedupe_video_views.sql`),
  which is deduped server-side, not client-side — it inserts a
  `(video_id, viewer_id)` row into `video_views` (PK, so a repeat call is a
  no-op) and only increments the counter when that insert actually happened,
  returning whether it did. `FeedItem`'s `countedView` ref (`FeedScreen.tsx`)
  just guards against firing the RPC twice within one mount; the real
  once-per-user guarantee (across sessions, reloads, re-scrolling past an item)
  is the DB unique constraint. The client only bumps the on-screen count
  optimistically when the RPC reports a new view, so a re-watch doesn't show a
  bogus increment. There is intentionally no mechanism to push in-app view
  counts back to YouTube/Instagram's own view counts — neither platform
  exposes an API to increment another video's view count, and there isn't one
  to build against.
- **My Videos:** `FlatList` `numColumns` = `useResponsive().gridColumns` (1 → 4).
- **Form / content screens** (auth, Submit, Edit/Profile): the root `screen` style
  gets `maxWidth` + `alignSelf: 'center'` so content stays a readable column.

## Paid registration + referrals

DB: `supabase/migrations/0006_registration_payments_referrals.sql` +
`0010_manual_upi_payments.sql` (0007/0008/0009 also apply in between — run in
order). `profiles.payment_status` (`unpaid|submitted|approved|rejected`) gates
`videos` inserts via the `check_can_post` trigger; `MainStackNavigator` wraps
the tabs so `PaymentScreen` can be pushed over browse-only tabs. `SubmitScreen`
shows `<PaymentGate>` until `payment_status === 'approved'`.

Payment is **manual UPI**, not a payment gateway: `PaymentScreen` renders a
`upi://pay?pa=<upi_id>&pn=<payee>&am=<fee>&cu=INR` QR (`PaymentQrCode.tsx`,
generated client-side with the `qrcode` package — a data URI, not a stored
image, so it always reflects the live `app_settings.upi_id`/`upi_payee_name`)
plus the UPI ID as copyable text. The user pays with any UPI app, then enters
their UTR/transaction reference and attaches a screenshot (`expo-image-picker`
shim); submitting uploads the screenshot to the private `payment-proofs`
storage bucket (`<user_id>/<timestamp>.jpg`) and calls
`submit_registration_payment(p_upi_reference, p_screenshot_path)`, which
requires both and flips the row + profile to `submitted`. An admin reviews it
on the admin **Payments** page (screenshot shown via a signed URL) and calls
`approve_registration_payment` / `reject_registration_payment`; approval
credits the referrer `app_settings.referral_bonus_inr` once per payment.
`useRegistrationPayment` polls while `submitted`. There is no automatic
approval path — a payment is only ever approved by an admin looking at the
UTR and screenshot. (An earlier iteration used Razorpay Checkout for
automatic verification; 0010 reverted it because the product now wants manual
UTR + screenshot review instead.) Referral code entered at sign-up
(`options.data.referral_code`); balance shown on `ProfileScreen`. The Profile card
shares an invite link `<origin>/?ref=CODE`; `src/lib/referral.ts` lifts `?ref=` on
app start (`App.tsx`) into `sessionStorage`, `AuthNavigator` then opens on `SignUp`
with the code pre-filled.

## Referral wallet + withdrawals

DB: `supabase/migrations/0008_referral_withdrawals.sql`. `app_settings` gains
`min_referral_withdrawal_inr` (default ₹150, editable from admin **Settings**).
`ReferralWalletScreen` (ProfileStack, linked from the Profile referral card)
shows the balance, a withdraw form (amount + UPI ID), and a merged transaction
list of `referral_earnings` (credits) and `referral_withdrawals` (debits) —
`useReferralWallet` hook. Withdrawing calls the `request_referral_withdrawal`
RPC, which is **auto-approved**: it locks the profile row, checks the amount is
≥ the minimum and ≤ the balance, debits `referral_balance_inr`, and writes a
`paid` `referral_withdrawals` row in one transaction. Admins see every
withdrawal (global + per user, with per-user earned/paid/balance rollups) on the
admin **Referrals** page and can `set_referral_withdrawal_status` to
`failed`/`reversed` (refunds the balance) or back to `paid` (re-debits).
