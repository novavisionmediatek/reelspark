import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { colors, fonts, radius, spacing, type } from '../theme/tokens';
import type { ProfileStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<ProfileStackParamList, 'HelpSupport'>;

const SUPPORT_EMAIL = 'support@reelspark.in';

const FAQS: { q: string; a: string }[] = [
  {
    q: 'How long does video review take?',
    a: 'Most submissions are reviewed within 24 hours. You can track the status on the My Videos tab.',
  },
  {
    q: 'Why was my video rejected?',
    a: 'Open the video on My Videos — the rejection reason is shown there. Common causes are broken links, duplicate submissions, or content that breaks the guidelines.',
  },
  {
    q: 'When do I get my referral bonus?',
    a: 'The bonus is credited to your referral balance once the friend you invited completes paid registration.',
  },
  {
    q: 'How do I change my password?',
    a: 'Go to Account settings and tap “Send password reset email”. Follow the link in that email to set a new one.',
  },
];

export function HelpSupportScreen({ navigation }: Props) {
  const [open, setOpen] = useState<number | null>(0);

  function contactSupport() {
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('ReelSpark support request')}`;
    Linking.openURL(url).catch(() => {
      /* no mail handler available */
    });
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Feather name="arrow-left" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Help &amp; support</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionLabel}>Frequently asked</Text>
        <View style={styles.card}>
          {FAQS.map((faq, i) => {
            const isOpen = open === i;
            return (
              <View key={faq.q} style={[styles.faqItem, i > 0 && styles.faqDivider]}>
                <Pressable style={styles.faqQuestionRow} onPress={() => setOpen(isOpen ? null : i)}>
                  <Text style={styles.faqQuestion}>{faq.q}</Text>
                  <Feather name={isOpen ? 'chevron-down' : 'chevron-right'} size={16} color={colors.textMuted} />
                </Pressable>
                {isOpen && <Text style={styles.faqAnswer}>{faq.a}</Text>}
              </View>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>Still need help?</Text>
        <Pressable style={styles.contactRow} onPress={contactSupport}>
          <Feather name="mail" size={18} color={colors.pink} />
          <View style={styles.contactText}>
            <Text style={styles.contactTitle}>Email support</Text>
            <Text style={styles.contactSub}>{SUPPORT_EMAIL}</Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.textMuted} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, width: '100%', maxWidth: 600, alignSelf: 'center', backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  title: { ...type.h3, color: colors.text },
  content: { padding: spacing.xl, gap: spacing.xs },
  sectionLabel: {
    ...type.label,
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
  },
  faqItem: { paddingVertical: spacing.md },
  faqDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  faqQuestionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  faqQuestion: { flex: 1, color: colors.text, fontFamily: fonts.bodyMedium, fontSize: 13.5 },
  faqAnswer: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 19, marginTop: spacing.sm },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.xs,
  },
  contactText: { flex: 1, gap: 2 },
  contactTitle: { color: colors.text, fontFamily: fonts.bodyMedium, fontSize: 13.5 },
  contactSub: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 11.5 },
});
