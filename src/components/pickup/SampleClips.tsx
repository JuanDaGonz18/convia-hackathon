import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { PICKUP_SAMPLES, type PickupSample } from '@/services/pickupVerificationService';

const ICONS: Record<PickupSample, 'checkmark-circle-outline' | 'swap-horizontal' | 'eye-off-outline'> = {
  match: 'checkmark-circle-outline',
  other: 'swap-horizontal',
  covered: 'eye-off-outline',
};

/**
 * Demo accounts only: run the real check on a sample clip of a fictional car
 * (the trip's car, another car, or the trip's car with its plate covered).
 */
export function SampleClips({ onPick, disabled = false }: Readonly<{ onPick: (sample: PickupSample) => void; disabled?: boolean }>) {
  const { t } = useTranslation();
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Ionicons color={colors.primary} name="film-outline" size={18} />
        <Text style={styles.title}>{t('pickup.samples.title')}</Text>
      </View>
      <Text style={styles.text}>{t('pickup.samples.text')}</Text>
      {PICKUP_SAMPLES.map((sample) => (
        <ButtonSecondary disabled={disabled} icon={ICONS[sample]} key={sample} onPress={() => onPick(sample)} title={t(`pickup.samples.${sample}`)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.primaryLight, borderRadius: radius.radiusLarge, gap: spacing[8], padding: spacing[16] },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing[8] },
  title: { ...typography.bodyMedium, color: colors.text, flex: 1, fontWeight: '700' },
  text: { ...typography.bodySmall, color: colors.textSecondary },
});
