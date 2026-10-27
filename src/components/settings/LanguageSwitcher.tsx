import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { LANGUAGE_PREFERENCES } from '@/i18n/languages';
import { useLanguagePreference } from '@/i18n/useLanguagePreference';

/**
 * Sistema · Español · English. `compact` is the small version for the top of
 * the login and sign-up screens.
 */
export function LanguageSwitcher({ compact = false }: Readonly<{ compact?: boolean }>) {
  const { t } = useTranslation();
  const [preference, setPreference] = useLanguagePreference();
  return (
    <View accessibilityLabel={t('language.selectorLabel')} accessibilityRole="radiogroup" style={[styles.row, compact && styles.rowCompact]}>
      {compact ? <Ionicons color={colors.textSecondary} name="language-outline" size={16} /> : null}
      {LANGUAGE_PREFERENCES.map((option) => {
        const selected = option === preference;
        return (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            hitSlop={compact ? 6 : 0}
            key={option}
            onPress={() => void setPreference(option)}
            style={[styles.option, compact && styles.optionCompact, selected && styles.optionSelected]}
          >
            <Text style={[styles.label, compact && styles.labelCompact, selected && styles.labelSelected]}>{t(`language.${option}`)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { backgroundColor: colors.surfaceMuted, borderRadius: radius.radiusMedium, flexDirection: 'row', gap: spacing[4], padding: spacing[4] },
  rowCompact: { alignItems: 'center', alignSelf: 'center', backgroundColor: 'transparent', gap: spacing[8], padding: 0 },
  option: { alignItems: 'center', borderRadius: radius.radiusSmall, flex: 1, paddingVertical: spacing[8] },
  // flex: 0 alone keeps the flexBasis: 0 from 'option' on the web, which collapses the labels.
  optionCompact: { flexBasis: 'auto', flexGrow: 0, flexShrink: 0, paddingHorizontal: spacing[8], paddingVertical: spacing[4] },
  optionSelected: { backgroundColor: colors.white },
  label: { ...typography.bodySmall, color: colors.textSecondary, fontWeight: '600' },
  labelCompact: { ...typography.caption },
  labelSelected: { color: colors.primary },
});
