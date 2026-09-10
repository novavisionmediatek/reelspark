import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { useAuth } from '../lib/AuthProvider';
import { supabase } from '../lib/supabase';
import { useMyVideos } from '../hooks/useMyVideos';
import { useAppSettings } from '../hooks/useAppSettings';
import { referralLink } from '../lib/referral';
import { colors, fonts, radius, spacing, type } from '../theme/tokens';
import type { MainStackParamList, ProfileStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<ProfileStackParamList, 'ProfileHome'>;

const SETTINGS_ITEMS: { label: string; screen: keyof ProfileStackParamList }[] = [
  { label: 'Account settings', screen: 'AccountSettings' },
  { label: 'Notifications', screen: 'Notifications' },
  { label: 'Help & support', screen: 'HelpSupport' },
];

const PAYMENT_PILL: Record<string, { label: string; color: string }> = {
  approved: { label: 'Member', color: colors.purple },
  expired: { label: 'Renewal due', color: colors.coral },
  submitted: { label: 'Payment in review', color: colors.magenta },
  rejected: { label: 'Payment rejected', color: colors.coral },
  unpaid: { label: 'Not registered', color: colors.textMuted },
};

function ReferralCard() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const profileNav = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const { profile } = useAuth();
  const { settings } = useAppSettings();
  const [copied, setCopied] = useState(false);

  const code = profile?.referral_code ?? '';
  const status = profile?.payment_status ?? 'unpaid';
  const paidUntilMs = profile?.paid_until ? new Date(profile.paid_until).getTime() : null;
  const expired = status === 'approved' && paidUntilMs !== null && paidUntilMs <= Date.now();
  const pill = expired ? PAYMENT_PILL.expired : PAYMENT_PILL[status] ?? PAYMENT_PILL.unpaid;

  const { data: friendCount } = useQuery({
    queryKey: ['referralCount', profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('referral_earnings')
        .select('*', { count: 'exact', head: true })
        .eq('referrer_id', profile!.id);
      if (error) throw error;
      return count ?? 0;
    },
  });

  async function shareInvite() {
    if (!code) return;
    const link = referralLink(code);
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({
          title: 'Join me on ReelSpark',
          text: `Sign up with my referral code ${code}`,
          url: link,
        });
        return;
      }
    } catch {
      /* user dismissed the share sheet — fall through to copy */
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <View style={styles.referralCard}>
      <View style={styles.referralHead}>
        <Text style={styles.referralTitle}>Refer &amp; earn</Text>
        <Pressable onPress={() => navigation.navigate('Payment')}>
          <Text style={[styles.pill, { color: pill.color, borderColor: pill.color }]}>{pill.label}</Text>
        </Pressable>
      </View>

      <Text style={styles.referralBody}>
        Friends who join with your code and complete registration earn you ₹{settings.referral_bonus_inr}.
      </Text>

      <Pressable style={styles.codeRow} onPress={shareInvite}>
        <Text style={styles.code}>{code || '—'}</Text>
        <Feather name={copied ? 'check-circle' : 'share-2'} size={15} color={copied ? colors.purple : colors.pink} />
        <Text style={styles.codeHint}>{copied ? 'Link copied' : 'Tap to share invite link'}</Text>
      </Pressable>

      <View style={styles.referralStatsRow}>
        <View>
          <Text style={styles.referralStatNum}>₹{profile?.referral_balance_inr ?? 0}</Text>
          <Text style={styles.referralStatLbl}>Referral balance</Text>
        </View>
        <View>
          <Text style={styles.referralStatNum}>{friendCount ?? 0}</Text>
          <Text style={styles.referralStatLbl}>Friends joined</Text>
        </View>
      </View>

      <Pressable style={styles.walletRow} onPress={() => profileNav.navigate('ReferralWallet')}>
        <Feather name="credit-card" size={14} color={colors.pink} />
        <Text style={styles.walletLink}>Withdraw &amp; transactions</Text>
        <Feather name="chevron-right" size={16} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

export function ProfileScreen({ navigation }: Props) {
  const { profile } = useAuth();
  const { data: videos } = useMyVideos();

  const totalViews = (videos ?? []).reduce((sum, v) => sum + v.view_count_in_app, 0);
  const initials = (profile?.display_name || '??').slice(0, 2).toUpperCase();

  function handleLogout() {
    const confirmed = typeof window === 'undefined' || window.confirm('Log out of ReelSpark?');
    if (confirmed) supabase.auth.signOut();
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.head}>
          <View style={styles.avatarRing}>
            <Avatar initials={initials} imageUri={profile?.avatar_url} size={78} />
          </View>
          <Text style={styles.name}>{profile?.display_name || 'Add your name'}</Text>
          {profile?.bio && <Text style={styles.bio}>{profile.bio}</Text>}

          {(profile?.youtube_handle || profile?.instagram_handle) && (
            <View style={styles.handleRow}>
              {profile?.youtube_handle && (
                <View style={styles.handleChip}>
                  <View style={[styles.platformMark, { backgroundColor: colors.orange }]}>
                    <Text style={styles.platformMarkText}>YT</Text>
                  </View>
                  <Text style={styles.handleText}>{profile.youtube_handle}</Text>
                </View>
              )}
              {profile?.instagram_handle && (
                <View style={styles.handleChip}>
                  <View style={[styles.platformMark, { backgroundColor: colors.magenta }]}>
                    <Text style={styles.platformMarkText}>IG</Text>
                  </View>
                  <Text style={styles.handleText}>{profile.instagram_handle}</Text>
                </View>
              )}
            </View>
          )}
        </View>

        <View style={styles.statTiles}>
          <View style={styles.statTile}>
            <Text style={styles.statNum}>{videos?.length ?? 0}</Text>
            <Text style={styles.statLbl}>Videos submitted</Text>
          </View>
          <View style={styles.statTile}>
            <Text style={styles.statNum}>{totalViews}</Text>
            <Text style={styles.statLbl}>In-app views</Text>
            <Text style={styles.statSub}>not your real platform count</Text>
          </View>
        </View>

        <ReferralCard />

        <Button label="Edit profile" variant="secondary" onPress={() => navigation.navigate('EditProfile')} />

        <View style={styles.settingsList}>
          {SETTINGS_ITEMS.map((item) => (
            <Pressable
              key={item.screen}
              style={styles.settingsItem}
              onPress={() => navigation.navigate(item.screen)}
            >
              <Text style={styles.settingsLabel}>{item.label}</Text>
              <Feather name="chevron-right" size={18} color="#4A4A52" />
            </Pressable>
          ))}
          <Pressable style={styles.settingsItem} onPress={handleLogout}>
            <Text style={[styles.settingsLabel, styles.danger]}>Log out</Text>
            <Feather name="chevron-right" size={18} color={colors.coral} />
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, width: '100%', maxWidth: 600, alignSelf: 'center', backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.lg },
  head: { alignItems: 'center', gap: 4 },
  avatarRing: { position: 'relative' },
  name: { ...type.h3, color: colors.text, marginTop: spacing.sm },
  bio: { ...type.bodySmall, color: colors.textMuted, textAlign: 'center' },
  handleRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  handleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    paddingLeft: 6,
  },
  platformMark: { width: 18, height: 18, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  platformMarkText: { color: '#fff', fontFamily: fonts.bodyBold, fontSize: 9 },
  handleText: { color: colors.text, fontFamily: fonts.bodyMedium, fontSize: 12 },
  referralCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  referralHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  referralTitle: { ...type.h3, color: colors.text },
  pill: {
    fontFamily: fonts.bodySemibold,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: 3,
    paddingHorizontal: 8,
    overflow: 'hidden',
  },
  referralBody: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 2,
  },
  code: { flex: 1, fontFamily: fonts.monoSemibold, fontSize: 15, color: colors.text, letterSpacing: 1 },
  codeHint: { fontFamily: fonts.body, fontSize: 11, color: colors.textMuted },
  referralStatsRow: { flexDirection: 'row', gap: spacing['2xl'], marginTop: spacing.sm },
  referralStatNum: { fontFamily: fonts.monoSemibold, fontSize: 18, color: colors.text },
  referralStatLbl: { fontFamily: fonts.body, fontSize: 10.5, color: colors.textMuted, marginTop: 2 },
  walletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  walletLink: { flex: 1, fontFamily: fonts.bodySemibold, fontSize: 12.5, color: colors.pink },
  statTiles: { flexDirection: 'row', gap: spacing.sm },
  statTile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
  },
  statNum: { fontFamily: fonts.monoSemibold, fontSize: 20, color: colors.text },
  statLbl: { fontFamily: fonts.body, fontSize: 10.5, color: colors.textMuted, marginTop: 2 },
  statSub: { fontFamily: fonts.body, fontSize: 9, color: '#68686F', marginTop: 3 },
  settingsList: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.sm },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  settingsLabel: { color: colors.text, fontFamily: fonts.body, fontSize: 13.5 },
  danger: { color: colors.coral },
});
