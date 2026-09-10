import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { PlatformChip } from '../components/PlatformChip';
import { detectPlatform } from '../lib/urlParsers';
import { useSubmitVideo } from '../hooks/useSubmitVideo';
import { useAuth } from '../lib/AuthProvider';
import { useAppSettings } from '../hooks/useAppSettings';
import { colors, fonts, spacing, type } from '../theme/tokens';
import type { MainStackParamList } from '../navigation/types';

const EXAMPLE_URL = 'https://youtube.com/shorts/9kLmR2vTqXo';

const GATE_COPY: Record<string, string> = {
  unpaid: 'Activate your yearly membership to unlock video posting.',
  rejected: 'Your last payment was reversed. Open registration to pay again.',
  expired: 'Your membership has expired. Renew it to keep posting.',
};

// Membership is "active" only when the payment is approved AND still inside the
// paid year (paid_until in the future). paid_until null = legacy approved row.
function membershipIsActive(profile: { payment_status: string; paid_until: string | null } | null) {
  if (!profile || profile.payment_status !== 'approved') return false;
  return !profile.paid_until || new Date(profile.paid_until).getTime() > Date.now();
}

function PaymentGate() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { profile } = useAuth();
  const { settings } = useAppSettings();
  const status = profile?.payment_status ?? 'unpaid';
  const paidUntilMs = profile?.paid_until ? new Date(profile.paid_until).getTime() : null;
  const expired = status === 'approved' && paidUntilMs !== null && paidUntilMs <= Date.now();
  const key = expired ? 'expired' : status === 'rejected' ? 'rejected' : 'unpaid';

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.gate}>
        <View style={styles.gateIcon}>
          <Feather name="loader" size={22} color={colors.pink} />
        </View>
        <Text style={styles.gateTitle}>
          {expired ? 'Renew your membership' : `Activate your ₹${settings.registration_fee_inr}/year membership`}
        </Text>
        <Text style={styles.gateBody}>{GATE_COPY[key]}</Text>
        <Button
          label={expired ? 'Renew membership' : 'Activate membership'}
          onPress={() => navigation.navigate('Payment')}
          style={{ marginTop: spacing.lg }}
        />
      </View>
    </SafeAreaView>
  );
}

export function SubmitScreen() {
  const { profile } = useAuth();

  if (profile && !membershipIsActive(profile)) {
    return <PaymentGate />;
  }
  return <SubmitForm />;
}

function SubmitForm() {
  const [url, setUrl] = useState('');
  const submitVideo = useSubmitVideo();

  const detection = useMemo(() => detectPlatform(url), [url]);
  const isValid = detection.platform !== null;

  function handleSubmit() {
    submitVideo.mutate(url, {
      onSuccess: () => setUrl(''),
    });
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Submit a video</Text>
        <Text style={styles.subtitle}>Paste a link to your own YouTube Shorts or Instagram Reel.</Text>
      </View>

      <Text style={styles.fieldLabel}>Video URL</Text>
      <TextField
        value={url}
        onChangeText={(v) => {
          setUrl(v);
          submitVideo.reset();
        }}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="https://youtube.com/shorts/…"
        valid={isValid}
      />

      {isValid ? (
        <View style={styles.validateRow}>
          <Feather name="check-circle" size={14} color={colors.purple} />
          <Text style={styles.validateText}>
            {detection.platform === 'youtube' ? 'YouTube Shorts detected' : 'Instagram Reel detected'}
          </Text>
        </View>
      ) : (
        <Pressable onPress={() => setUrl(EXAMPLE_URL)}>
          <Text style={styles.tryLink}>Try an example link →</Text>
        </Pressable>
      )}

      {isValid && (
        <View style={styles.metaPreview}>
          <View style={styles.metaThumb} />
          <View style={styles.metaInfo}>
            <Text style={styles.metaTitle} numberOfLines={1}>
              {detection.videoId ? `Video ${detection.videoId}` : 'Untitled submission'}
            </Text>
            <Text style={styles.metaAuthor}>
              {detection.platform === 'youtube' ? 'Title & thumbnail load on submit' : 'Instagram metadata coming soon'}
            </Text>
            <PlatformChip platform={detection.platform!} />
          </View>
        </View>
      )}

      <View style={styles.footer}>
        {submitVideo.isSuccess ? (
          <Text style={styles.successText}>Submitted! We'll review it shortly.</Text>
        ) : (
          <Button
            label={submitVideo.isPending ? 'Submitting…' : 'Submit video'}
            disabled={!isValid || submitVideo.isPending}
            onPress={handleSubmit}
          />
        )}
        {submitVideo.isPending && <ActivityIndicator color={colors.pink} />}
        {submitVideo.isError && (
          <Text style={styles.errorText}>{(submitVideo.error as Error)?.message ?? 'Something went wrong.'}</Text>
        )}
        <Text style={styles.helperNote}>Your video stays on YouTube — we never re-host your content.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    backgroundColor: colors.background,
    padding: spacing.xl,
  },
  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  gateIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(253,54,103,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  gateTitle: { ...type.h3, color: colors.text, textAlign: 'center' },
  gateBody: { ...type.bodySmall, color: colors.textMuted, textAlign: 'center', maxWidth: 300 },
  header: { marginTop: spacing.md, marginBottom: spacing.lg, gap: spacing.xs },
  title: { ...type.h2, color: colors.text },
  subtitle: { ...type.bodySmall, color: colors.textMuted },
  fieldLabel: {
    ...type.label,
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  validateRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: spacing.sm },
  validateText: { color: colors.purple, fontFamily: fonts.bodySemibold, fontSize: 12 },
  tryLink: { color: colors.pink, fontFamily: fonts.bodySemibold, fontSize: 12, marginTop: spacing.md },
  metaPreview: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
    flexDirection: 'row',
    gap: spacing.md,
  },
  metaThumb: { width: 64, height: 64, borderRadius: 8, backgroundColor: colors.deepPurple },
  metaInfo: { flex: 1, gap: 4, justifyContent: 'center' },
  metaTitle: { color: colors.text, fontFamily: fonts.bodySemibold, fontSize: 13 },
  metaAuthor: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 11.5 },
  footer: { marginTop: 'auto', gap: spacing.sm, paddingBottom: spacing.md },
  successText: { color: colors.purple, fontFamily: fonts.bodySemibold, fontSize: 14, textAlign: 'center' },
  errorText: { color: colors.coral, fontFamily: fonts.body, fontSize: 12, textAlign: 'center' },
  helperNote: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 11, textAlign: 'center' },
});
