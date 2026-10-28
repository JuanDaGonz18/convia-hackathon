import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { MetaAiBadge } from '@/components/ai/MetaAiBadge';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import type { SuggestionResult } from '@/services/vehicleSuggestionService';

export type SuggestionState = { status: 'loading' } | SuggestionResult;

/**
 * Under the vehicle photo: Muse Spark's proposal for the form. Nothing is
 * filled in until the driver taps "Usar estos datos", and every field stays
 * editable afterwards.
 */
export function VehicleSuggestionCard({ state, onApply, onDismiss }: Readonly<{
  state: SuggestionState;
  onApply: () => void;
  onDismiss: () => void;
}>) {
  const { t } = useTranslation();

  if (state.status === 'loading') {
    return (
      <View accessibilityLiveRegion="polite" style={[styles.card, styles.row]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.muted}>{t('vehicleSuggestion.loading')}</Text>
      </View>
    );
  }

  if (state.status !== 'ok') {
    return (
      <View style={[styles.card, styles.row]}>
        <Ionicons color={colors.textSecondary} name="information-circle-outline" size={18} />
        <Text style={styles.muted}>{t(state.status === 'unclear' ? 'vehicleSuggestion.unclear' : 'vehicleSuggestion.unavailable')}</Text>
        <Pressable accessibilityLabel={t('vehicleSuggestion.dismiss')} hitSlop={8} onPress={onDismiss}>
          <Ionicons color={colors.textSecondary} name="close" size={18} />
        </Pressable>
      </View>
    );
  }

  const { brand, line, color, plate } = state.suggestion;
  const rows = [
    { label: t('vehicle.brandLabel'), value: [brand, line].filter(Boolean).join(' ') || null },
    { label: t('vehicle.colorLabel'), value: color },
    { label: t('vehicle.plateLabel'), value: plate },
  ];

  return (
    <View accessibilityLiveRegion="polite" style={styles.card}>
      <View style={styles.row}>
        <Ionicons color={colors.primary} name="sparkles" size={18} />
        <Text style={styles.title}>{t('vehicleSuggestion.title')}</Text>
      </View>
      <MetaAiBadge feature="autofill" />
      {rows.map((row) => (
        <View key={row.label} style={styles.field}>
          <Text style={styles.fieldLabel}>{row.label}</Text>
          <Text style={row.value ? styles.fieldValue : styles.fieldMissing}>{row.value ?? t('vehicleSuggestion.notSure')}</Text>
        </View>
      ))}
      <Text style={styles.muted}>{t('vehicleSuggestion.review')}</Text>
      {state.mock ? <Text style={styles.muted}>{t('vehicleSuggestion.mock')}</Text> : null}
      <View style={styles.actions}>
        <View style={styles.flex}>
          <ButtonSecondary onPress={onDismiss} title={t('vehicleSuggestion.ignore')} />
        </View>
        <View style={styles.flex}>
          <ButtonPrimary icon="checkmark" onPress={onApply} title={t('vehicleSuggestion.apply')} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusLarge,
    gap: spacing[8],
    padding: spacing[16],
  },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing[8] },
  flex: { flex: 1 },
  title: { ...typography.bodyMedium, color: colors.text, flex: 1, fontWeight: '700' },
  muted: { ...typography.bodySmall, color: colors.textSecondary, flex: 1 },
  field: { flexDirection: 'row', gap: spacing[8], justifyContent: 'space-between' },
  fieldLabel: { ...typography.bodySmall, color: colors.textSecondary },
  fieldValue: { ...typography.bodySmall, color: colors.text, flexShrink: 1, fontWeight: '600', textAlign: 'right' },
  fieldMissing: { ...typography.bodySmall, color: colors.textSecondary, flexShrink: 1, fontStyle: 'italic', textAlign: 'right' },
  actions: { flexDirection: 'row', gap: spacing[8], marginTop: spacing[4] },
});
