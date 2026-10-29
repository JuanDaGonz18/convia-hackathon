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
 * Sistema · Español · English as one segmented control with 44 dp touch targets,
 * the same on Android, iOS and the web. `compact` (login and sign-up) adds a
 * small "Language" title above it; Appearance shows its own heading.
 */
export function LanguageSwitcher({ compact = false }: Readonly<{ compact?: boolean }>) {
  const { t } = useTranslation();
  const [preference, setPreference] = useLanguagePreference();
  return (
    <View style={styles.wrap}>
      {compact ? (
        <View style={styles.title}>
          <Ionicons color={colors.textSecondary} name="language-outline" size={16} />
          <Text style={styles.titleText}>{t('language.label')}</Text>
        </View>
      ) : null}
      <View accessibilityLabel={t('language.selectorLabel')} accessibilityRole="radiogroup" style={styles.row}>
        {LANGUAGE_PREFERENCES.map((option) => {
          const selected = option === preference;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, selected }}
              android_ripple={{ borderless: false, color: colors.primaryLight }}
              key={option}
              onPress={() => void setPreference(option)}
              style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && !selected && styles.optionPressed]}
            >
              <Text numberOfLines={1} style={[styles.label, selected && styles.labelSelected]}>{t(`language.${option}`)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', gap: spacing[8] },
  title: { alignItems: 'center', flexDirection: 'row', gap: spacing[4], justifyContent: 'center' },
  titleText: { ...typography.caption, color: colors.textSecondary },
  row: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: radius.radiusMedium,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing[4],
    overflow: 'hidden',
    padding: spacing[4],
  },
  // flexBasis 0 with flexGrow 1 gives three equal segments on every platform.
  option: { alignItems: 'center', borderRadius: radius.radiusSmall, flexBasis: 0, flexGrow: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: spacing[8] },
  optionSelected: { backgroundColor: colors.white, elevation: 1, shadowColor: '#000', shadowOffset: { height: 1, width: 0 }, shadowOpacity: 0.08, shadowRadius: 2 },
  optionPressed: { opacity: 0.7 },
  label: { ...typography.bodySmall, color: colors.textSecondary, fontWeight: '600' },
  labelSelected: { color: colors.primary },
});
