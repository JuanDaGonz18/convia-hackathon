import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { useMembership } from '@/services/membershipService';
import { useAppStore } from '@/store/appStore';

/**
 * Shown on Home, Trips and Chats until the user's institution is verified: trips, people and
 * chats are only shared inside a verified institution (the server enforces it). Renders
 * nothing once verified (or while loading).
 */
export function VerifyInstitutionCard() {
  const { t } = useTranslation();
  const membership = useMembership();
  const firstName = useAppStore((state) => state.currentUser?.name)?.trim().split(/\s+/)[0];
  if (!membership || membership.status === 'verified') return null;
  const key = membership.status === 'none' ? 'none' : membership.status === 'review' ? 'review' : 'pending';
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Ionicons color={colors.primary} name={key === 'review' ? 'hourglass-outline' : 'school-outline'} size={22} />
        {/* With the user's first name when we have it; never a bare placeholder. */}
        <Text style={styles.title}>{key === 'pending' && firstName ? t('verifyCard.pending.titleNamed', { name: firstName }) : t(`verifyCard.${key}.title`)}</Text>
      </View>
      <Text style={styles.text}>{t(`verifyCard.${key}.text`, { institution: membership.institution?.nombre || t('verifyCard.yourInstitution') })}</Text>
      <ButtonPrimary onPress={() => router.push('/institution')} title={t(`verifyCard.${key}.action`)} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.primaryLight, borderColor: colors.primary, borderRadius: radius.radiusLarge, borderWidth: 1, gap: spacing[8], padding: spacing[16] },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing[8] },
  title: { ...typography.bodyMedium, color: colors.text, flex: 1, fontWeight: '700' },
  text: { ...typography.bodySmall, color: colors.text },
});
