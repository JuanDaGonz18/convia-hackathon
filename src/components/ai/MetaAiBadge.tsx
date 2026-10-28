import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';

/** Every place a Meta model works for the user; the tooltip says which model does what. */
export type MetaAiFeature = 'pickup' | 'autofill' | 'vehicleCheck' | 'studentCard' | 'agent';

/**
 * "✨ AI by Meta", the same small badge wherever a Meta model is used. Tapping it shows one
 * line on which model does what (and taps again to hide it).
 */
export function MetaAiBadge({ feature }: Readonly<{ feature: MetaAiFeature }>) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityHint={t('metaAi.hint')}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        hitSlop={8}
        onPress={() => setOpen((value) => !value)}
        style={styles.badge}
      >
        <Text style={styles.badgeText}>{t('metaAi.badge')}</Text>
      </Pressable>
      {open ? <Text accessibilityLiveRegion="polite" style={styles.tooltip}>{t(`metaAi.${feature}`)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'flex-start', gap: spacing[4] },
  badge: { backgroundColor: '#EEF2FF', borderColor: '#C7D2FE', borderRadius: radius.radiusFull, borderWidth: 1, paddingHorizontal: spacing[8], paddingVertical: 2 },
  badgeText: { ...typography.caption, color: '#3730A3', fontWeight: '600' },
  tooltip: { ...typography.caption, backgroundColor: colors.surfaceMuted, borderRadius: radius.radiusSmall, color: colors.textSecondary, paddingHorizontal: spacing[8], paddingVertical: spacing[4] },
});
