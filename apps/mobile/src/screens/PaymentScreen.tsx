import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button } from '../components/Button';
import { useAuth } from '../lib/AuthProvider';
import { useAppSettings } from '../hooks/useAppSettings';
import {
  isConfirming,
  useReconcilePayment,
  useRegistrationPayment,
  usePayWithRazorpay,
} from '../hooks/useRegistrationPayment';
import { colors, fonts, radius, spacing, type } from '../theme/tokens';
import type { MainStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<MainStackParamList, 'Payment'>;

const DAY_MS = 86_400_000;
const RENEW_WINDOW_MS = 30 * DAY_MS;

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function payErrorMessage(raw: string) {
  switch (raw) {
    case 'membership_active':
      return 'Your membership is already active.';
    case 'too_many_attempts':
      return 'Too many attempts — wait a few minutes and try again.';
    case 'razorpay_order_failed':
    case 'start_payment_failed':
      return "Couldn't start the payment. Please try again.";
    default:
      return raw || 'Something went wrong. Please try again.';
  }
}

export function PaymentScreen({ navigation }: Props) {
  const { profile, refreshProfile } = useAuth();
  const { settings } = useAppSettings();
  const { data: payment } = useRegistrationPayment();
  const pay = usePayWithRazorpay();
  const reconcile = useReconcilePayment();

  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const fee = settings.registration_fee_inr;
  const status = profile?.payment_status ?? 'unpaid';
  const paidUntilIso = profile?.paid_until ?? null;
  const paidUntilMs = paidUntilIso ? new Date(paidUntilIso).getTime() : null;
  const now = Date.now();

  // "Approved with no expiry on file" is treated as active (legacy safety) —
  // the migration backfills paid_until, so in practice it's always set.
  const membershipActive = status === 'approved' && (paidUntilMs === null || paidUntilMs > now);
  const membershipExpired = status === 'approved' && paidUntilMs !== null && paidUntilMs <= now;
  const expiringSoon = membershipActive && paidUntilMs !== null && paidUntilMs - now < RENEW_WINDOW_MS;

  // A confirmed payment (webhook or callback) flips profile.payment_status to
  // 'approved'; the 15s poll on the payment row + AuthProvider.refreshProfile
  // (fired from usePayWithRazorpay.onSuccess) bring it in without a reload.
  // `confirming` = a pay attempt this session whose verify call didn't confirm;
  // isConfirming() also covers a fresh 'created' row after a reload mid-payment.
  const showConfirming = !membershipActive && !membershipExpired && (confirming || isConfirming(payment));

  useEffect(() => {
    if (membershipActive) setConfirming(false);
  }, [membershipActive]);

  // Safety net: if the webhook hasn't confirmed within ~90s, drop the local
  // "confirming" flag so the user isn't stuck (isConfirming(payment) still keeps
  // the state up while a fresh 'created' row is genuinely mid-flight).
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 90_000);
    return () => clearTimeout(t);
  }, [confirming]);

  // Webhook-only confirmation path: the 15s poll picks up the payment row going
  // 'approved' before anything re-reads the profile — bridge it to the gate.
  useEffect(() => {
    if (payment?.status === 'approved' && status !== 'approved') refreshProfile();
  }, [payment?.status, status, refreshProfile]);

  async function handlePay() {
    setError(null);
    try {
      const outcome = await pay.mutateAsync();
      if (outcome === 'pending_webhook') setConfirming(true);
    } catch (e) {
      const msg = (e as Error)?.message ?? '';
      if (msg !== 'cancelled') setError(payErrorMessage(msg));
    }
  }

  // "Check again" on the confirming screen — reconcile against Razorpay's API.
  async function handleRecheck() {
    setError(null);
    try {
      const r = await reconcile.mutateAsync();
      if (r.status !== 'approved') {
        setError('Payment not confirmed yet. If you completed it, wait a moment and try again.');
      }
    } catch (e) {
      setError(payErrorMessage((e as Error)?.message ?? ''));
    }
  }

  // ---- active membership --------------------------------------------
  if (membershipActive) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centerCard}>
          <View style={[styles.iconCircle, { backgroundColor: 'rgba(125,39,227,0.18)' }]}>
            <Feather name="check-circle" size={26} color={colors.purple} />
          </View>
          <Text style={styles.cardTitle}>Membership active</Text>
          <Text style={styles.cardBody}>
            {paidUntilIso
              ? `You can submit Shorts and Reels until ${formatDate(paidUntilIso)}.`
              : 'You can submit your Shorts and Reels.'}
          </Text>
          {expiringSoon ? (
            <>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Button
                label={pay.isPending ? 'Opening…' : `Renew for ₹${fee}/year`}
                onPress={handlePay}
                disabled={pay.isPending}
                loading={pay.isPending}
                style={{ marginTop: spacing.lg }}
              />
              <Button
                label="Go to Submit"
                variant="secondary"
                onPress={() => navigation.navigate('Tabs', { screen: 'Submit' })}
              />
            </>
          ) : (
            <Button
              label="Go to Submit"
              onPress={() => navigation.navigate('Tabs', { screen: 'Submit' })}
              style={{ marginTop: spacing.lg }}
            />
          )}
        </View>
      </SafeAreaView>
    );
  }

  // ---- expired — renew --------------------------------------------
  if (membershipExpired) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centerCard}>
          <View style={[styles.iconCircle, { backgroundColor: 'rgba(254,73,64,0.14)' }]}>
            <Feather name="alert-circle" size={26} color={colors.coral} />
          </View>
          <Text style={styles.cardTitle}>Membership expired</Text>
          <Text style={styles.cardBody}>
            {paidUntilIso ? `Your membership expired on ${formatDate(paidUntilIso)}. ` : ''}
            Renew for ₹{fee}/year to keep posting Shorts and Reels.
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            label={pay.isPending ? 'Opening…' : `Renew for ₹${fee}/year`}
            onPress={handlePay}
            disabled={pay.isPending}
            loading={pay.isPending}
            style={{ marginTop: spacing.lg }}
          />
          <Button label="Back" variant="ghost" onPress={() => navigation.goBack()} />
        </View>
      </SafeAreaView>
    );
  }

  // ---- confirming (payment made, waiting on verification) ----------
  if (showConfirming) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centerCard}>
          <View style={[styles.iconCircle, { backgroundColor: 'rgba(219,50,147,0.18)' }]}>
            <ActivityIndicator color={colors.magenta} />
          </View>
          <Text style={styles.cardTitle}>Confirming your payment…</Text>
          <Text style={styles.cardBody}>
            This usually takes a few seconds and updates on its own. If you already paid, tap “Check again”.
            If your payment didn’t go through, you can pay again.
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            label={reconcile.isPending ? 'Checking…' : 'Check again'}
            onPress={handleRecheck}
            disabled={reconcile.isPending || pay.isPending}
            loading={reconcile.isPending}
            style={{ marginTop: spacing.lg }}
          />
          <Button
            label={pay.isPending ? 'Opening…' : `Pay ₹${fee} again`}
            variant="secondary"
            onPress={handlePay}
            disabled={pay.isPending || reconcile.isPending}
          />
          <Button label="Back" variant="ghost" onPress={() => navigation.goBack()} />
        </View>
      </SafeAreaView>
    );
  }

  // ---- unpaid / rejected — pay --------------------------------------
  const rejected = payment?.status === 'rejected';
  const referred = !!profile?.referred_by;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Activate your membership</Text>
          <Text style={styles.subtitle}>
            A ₹{fee}/year membership unlocks video posting. Pay securely with UPI, cards, net-banking or wallets
            via Razorpay — access is granted the moment the payment is confirmed.
          </Text>
        </View>

        {referred ? (
          <View style={styles.referralBox}>
            <Text style={styles.referralBoxTitle}>
              🎉 Your friend earns ₹{settings.referral_bonus_inr} when you join
            </Text>
            <Text style={styles.referralBoxNote}>
              You signed up with a referral code — complete your ₹{fee}/year registration below to lock it in.
            </Text>
          </View>
        ) : null}

        {rejected && payment ? (
          <View style={styles.rejectedBox}>
            <Text style={styles.rejectedTitle}>Previous payment was reversed</Text>
            {payment.admin_note ? <Text style={styles.rejectedNote}>“{payment.admin_note}”</Text> : null}
            <Text style={styles.rejectedNote}>You can pay again below.</Text>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          label={pay.isPending ? 'Opening…' : `Pay ₹${fee}`}
          onPress={handlePay}
          disabled={pay.isPending}
          loading={pay.isPending}
          style={{ marginTop: spacing.lg }}
        />
        <Button label="Cancel" variant="ghost" onPress={() => navigation.goBack()} />

        <View style={styles.legalRow}>
          <Text style={styles.legalNote}>By paying you agree to our </Text>
          {LEGAL_LINKS.map((link, i) => (
            <Text key={link.path}>
              <Text style={styles.legalLink} onPress={() => openLegal(link.path)}>
                {link.label}
              </Text>
              {i < LEGAL_LINKS.length - 1 ? <Text style={styles.legalNote}> · </Text> : null}
            </Text>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Public policy pages live as static HTML under /legal/*.html (see
// apps/mobile/assets/legal/). Razorpay requires these to be reachable from the
// payment context.
const LEGAL_LINKS = [
  { label: 'Terms', path: 'terms.html' },
  { label: 'Refund Policy', path: 'refund.html' },
  { label: 'Privacy', path: 'privacy.html' },
] as const;

function openLegal(path: string) {
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  Linking.openURL(`${base}/legal/${path}`).catch(() => {
    /* no handler available */
  });
}

const styles = StyleSheet.create({
  screen: { flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: colors.background },
  content: { padding: spacing.xl, paddingBottom: spacing['2xl'] },
  header: { gap: spacing.xs, marginBottom: spacing.lg, marginTop: spacing.sm },
  title: { ...type.h1, color: colors.text },
  subtitle: { ...type.bodySmall, color: colors.textMuted },

  centerCard: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  iconCircle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  cardTitle: { ...type.h3, color: colors.text, textAlign: 'center' },
  cardBody: { ...type.bodySmall, color: colors.textMuted, textAlign: 'center', maxWidth: 320 },

  error: { ...type.bodySmall, color: colors.coral, marginTop: spacing.sm, textAlign: 'center' },

  legalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  legalNote: { ...type.bodySmall, color: colors.textMuted },
  legalLink: { ...type.bodySmall, color: colors.textMuted, textDecorationLine: 'underline' },

  rejectedBox: {
    backgroundColor: 'rgba(254,73,64,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(254,73,64,0.4)',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    gap: 4,
  },
  rejectedTitle: { fontFamily: fonts.bodySemibold, fontSize: 13, color: colors.coral },
  rejectedNote: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted },

  referralBox: {
    backgroundColor: 'rgba(125,39,227,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(125,39,227,0.4)',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    gap: 4,
  },
  referralBoxTitle: { fontFamily: fonts.bodySemibold, fontSize: 13, color: colors.text },
  referralBoxNote: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted },
});
