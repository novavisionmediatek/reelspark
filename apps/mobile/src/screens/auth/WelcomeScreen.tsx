import { Linking, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button } from '../../components/Button';
import { Logo } from '../../components/Logo';
import { colors, fonts, gradient, spacing, type } from '../../theme/tokens';
import type { AuthStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Welcome'>;

// Static policy pages served at reelspark.in/legal/*.html — must be reachable
// without an account (Razorpay website checklist).
const LEGAL_LINKS = [
  { label: 'Terms', path: 'terms.html' },
  { label: 'Privacy', path: 'privacy.html' },
  { label: 'Pricing', path: 'pricing.html' },
  { label: 'Refunds', path: 'refund.html' },
  { label: 'Contact', path: 'contact.html' },
] as const;

function openLegal(path: string) {
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  Linking.openURL(`${base}/legal/${path}`).catch(() => {
    /* no handler available */
  });
}

export function WelcomeScreen({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <LinearGradient
        colors={['rgba(253,54,103,0.35)', 'transparent']}
        style={styles.glow}
        pointerEvents="none"
      />

      <View style={styles.top}>
        <Logo size={56} />
        <View style={styles.wordmarkRow}>
          <Text style={styles.wordmark}>Reel</Text>
          <Text style={[styles.wordmark, styles.wordmarkAccent]}>Spark</Text>
        </View>
        <Text style={styles.headline}>Boost your Shorts.{'\n'}Spark your audience.</Text>
        <Text style={styles.copy}>
          Submit your own YouTube Shorts or Instagram Reels and get real people
          watching — from creators who watch back. Posting is a ₹300/year membership.
        </Text>
      </View>

      <View style={styles.actions}>
        <Button label="Create account" onPress={() => navigation.navigate('SignUp')} />
        <Button label="I already have an account" variant="secondary" onPress={() => navigation.navigate('Login')} />
        <View style={styles.legalRow}>
          <Text style={styles.legal}>By continuing you agree to our </Text>
          {LEGAL_LINKS.map((link, i) => (
            <Text key={link.path}>
              <Text style={[styles.legal, styles.legalLink]} onPress={() => openLegal(link.path)}>
                {link.label}
              </Text>
              {i < LEGAL_LINKS.length - 1 ? <Text style={styles.legal}> · </Text> : null}
            </Text>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    backgroundColor: colors.background,
    justifyContent: 'flex-end',
    padding: spacing.xl,
  },
  glow: { position: 'absolute', top: '10%', left: '20%', width: 280, height: 280, borderRadius: 140 },
  top: { flex: 1, justifyContent: 'center', gap: spacing.md },
  wordmarkRow: { flexDirection: 'row', marginTop: spacing.sm },
  wordmark: { ...type.h2, color: colors.text },
  wordmarkAccent: { color: gradient.brand[2] },
  headline: { ...type.h1, color: colors.text, marginTop: spacing.sm },
  copy: { ...type.bodySmall, color: colors.textMuted, maxWidth: 280, lineHeight: 21 },
  actions: { gap: spacing.md, paddingBottom: spacing.lg },
  legalRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' },
  legal: { ...type.bodySmall, color: colors.textMuted, textAlign: 'center', fontSize: 11 },
  legalLink: { textDecorationLine: 'underline' },
});

