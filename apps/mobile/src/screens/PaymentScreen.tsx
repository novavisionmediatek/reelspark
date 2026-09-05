import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Feather } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { PaymentQrCode } from '../components/PaymentQrCode';
import { useAuth } from '../lib/AuthProvider';
import { useAppSettings } from '../hooks/useAppSettings';
import { useRegistrationPayment, useSubmitRegistrationPayment } from '../hooks/useRegistrationPayment';
import { colors, fonts, radius, spacing, type } from '../theme/tokens';
import type { MainStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<MainStackParamList, 'Payment'>;

export function PaymentScreen({ navigation }: Props) {
  const { profile, refreshProfile } = useAuth();
  const { settings } = useAppSettings();
  const { data: payment, isLoading } = useRegistrationPayment();
  const submitPayment = useSubmitRegistrationPayment();

  const [utr, setUtr] = useState('');
  const [screenshotUri, setScreenshotUri] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fee = settings.registration_fee_inr;
  const status = profile?.payment_status ?? 'unpaid';

  // Bridge the polled payment row to the profile gate.
  useEffect(() => {
    if (payment?.status === 'approved' && status !== 'approved') refreshProfile();
  }, [payment?.status, status, refreshProfile]);

  async function handlePickScreenshot() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setScreenshotUri(result.assets[0].uri);
    }
  }

  async function copyUpiId() {
    try {
      await navigator.clipboard.writeText(settings.upi_id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  async function handleSubmit() {
    setError(null);
    if (!utr.trim() || !screenshotUri) return;
    try {
      await submitPayment.mutateAsync({ utr: utr.trim(), screenshotUri });
    } catch (e) {
      setError((e as Error)?.message ?? 'Could not submit your payment. Please try again.');
    }
  }

  // ---- approved -------------------------------------------------------
  if (status === 'approved') {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centerCard}>
          <View style={[styles.iconCircle, { backgroundColor: 'rgba(125,39,227,0.18)' }]}>
            <Feather name="check-circle" size={26} color={colors.purple} />
          </View>
          <Text style={styles.cardTitle}>Registration approved</Text>
          <Text style={styles.cardBody}>You're all set — you can now submit your Shorts and Reels.</Text>
          <Button label="Go to Submit" onPress={() => navigation.navigate('Tabs', { screen: 'Submit' })} style={{ marginTop: spacing.lg }} />
        </View>
      </SafeAreaView>
    );
  }

  // ---- submitted / pending (manual admin review) ----------------------
  if (!isLoading && payment?.status === 'submitted') {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centerCard}>
          <View style={[styles.iconCircle, { backgroundColor: 'rgba(219,50,147,0.18)' }]}>
            <ActivityIndicator color={colors.magenta} />
          </View>
          <Text style={styles.cardTitle}>Waiting for approval</Text>
          <Text style={styles.cardBody}>
            We're verifying your ₹{payment.amount_inr} payment (ref. {payment.upi_reference}). This page updates
            automatically once an admin confirms it.
          </Text>
          <Button label="Back" variant="secondary" onPress={() => navigation.goBack()} style={{ marginTop: spacing.lg }} />
        </View>
      </SafeAreaView>
    );
  }

  // ---- unpaid / rejected — show the QR + proof form -------------------
  const rejected = payment?.status === 'rejected';
  const referred = !!profile?.referred_by;
  const canSubmit = utr.trim().length > 0 && !!screenshotUri;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Complete registration</Text>
          <Text style={styles.subtitle}>
            A one-time ₹{fee} fee unlocks video posting. Scan the QR with any UPI app, then tell us your transaction
            reference and attach a screenshot — an admin confirms it and posting unlocks right after.
          </Text>
        </View>

        {referred ? (
          <View style={styles.referralBox}>
            <Text style={styles.referralBoxTitle}>
              🎉 Congrats! You’ve got ₹{settings.referral_bonus_inr} on your referral
            </Text>
            <Text style={styles.referralBoxNote}>
              You joined with a friend’s code. Complete your ₹{fee} registration below to lock it in.
            </Text>
          </View>
        ) : null}

        {rejected && payment ? (
          <View style={styles.rejectedBox}>
            <Text style={styles.rejectedTitle}>Previous payment was rejected</Text>
            {payment.admin_note ? <Text style={styles.rejectedNote}>“{payment.admin_note}”</Text> : null}
            <Text style={styles.rejectedNote}>You can retry the payment below.</Text>
          </View>
        ) : null}

        <View style={styles.qrCard}>
          <Text style={styles.payLabel}>Scan to pay</Text>
          <Text style={styles.amount}>₹{fee}</Text>
          <PaymentQrCode upiId={settings.upi_id} payeeName={settings.upi_payee_name} amountInr={fee} />
          <Pressable style={styles.upiRow} onPress={copyUpiId} hitSlop={8}>
            <Text style={styles.upiId}>{settings.upi_id}</Text>
            <Feather name={copied ? 'check' : 'copy'} size={14} color={copied ? colors.purple : colors.textMuted} />
          </Pressable>
        </View>

        <Text style={styles.label}>Transaction reference (UTR)</Text>
        <TextField
          value={utr}
          onChangeText={setUtr}
          placeholder="e.g. 402816734521"
          autoCapitalize="characters"
        />

        <Text style={styles.label}>Payment screenshot</Text>
        <Pressable style={styles.screenshotPicker} onPress={handlePickScreenshot}>
          {screenshotUri ? (
            <Image source={{ uri: screenshotUri }} style={styles.screenshotPreview} />
          ) : (
            <View style={styles.screenshotPlaceholder}>
              <Feather name="image" size={20} color={colors.textMuted} />
              <Text style={styles.screenshotHint}>Tap to attach a screenshot</Text>
            </View>
          )}
        </Pressable>

        {(error || submitPayment.isError) ? (
          <Text style={styles.error}>{error ?? (submitPayment.error as Error)?.message}</Text>
        ) : null}

        <Button
          label={submitPayment.isPending ? 'Submitting…' : 'Submit for verification'}
          onPress={handleSubmit}
          disabled={!canSubmit || submitPayment.isPending}
          loading={submitPayment.isPending}
          style={{ marginTop: spacing.lg }}
        />
        <Button label="Cancel" variant="ghost" onPress={() => navigation.goBack()} />
      </ScrollView>
    </SafeAreaView>
  );
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

  qrCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  payLabel: {
    ...type.label,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  amount: { fontFamily: fonts.monoSemibold, fontSize: 32, color: colors.text, marginTop: -spacing.xs },
  upiRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  upiId: { fontFamily: fonts.mono, fontSize: 13, color: colors.text },

  label: {
    ...type.label,
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },

  screenshotPicker: {
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  screenshotPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing['2xl'] },
  screenshotHint: { ...type.bodySmall, color: colors.textMuted },
  screenshotPreview: { width: '100%', height: 220, resizeMode: 'contain', backgroundColor: colors.background },

  error: { ...type.bodySmall, color: colors.coral, marginTop: spacing.sm },

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
