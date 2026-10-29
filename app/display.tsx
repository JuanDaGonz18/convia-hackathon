import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { LanguageSwitcher } from '@/components/settings/LanguageSwitcher';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';

const THEMES = ['system', 'light', 'dark'] as const;
const THEME_KEYS = { system: 'appearance.themeSystem', light: 'appearance.themeLight', dark: 'appearance.themeDark' } as const;

/**
 * Profile → Apariencia e idioma. Language works now; the theme row is there,
 * disabled, until dark mode is built.
 */
export default function AppearanceScreen() {
  const { t } = useTranslation();
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader kicker={t('appearance.kicker')} title={t('appearance.title')} />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('appearance.languageSection')}</Text>
          <LanguageSwitcher />
          <Text style={styles.hint}>{t('language.systemHint')} {t('appearance.languageHint')}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('appearance.themeSection')}</Text>
          <View accessibilityState={{ disabled: true }} style={[styles.themeRow, styles.disabled]}>
            {THEMES.map((theme) => (
              <View key={theme} style={[styles.themeOption, theme === 'light' && styles.themeSelected]}>
                <Text style={[styles.themeLabel, theme === 'light' && styles.themeLabelSelected]}>{t(THEME_KEYS[theme])}</Text>
              </View>
            ))}
          </View>
          <View style={styles.soon}>
            <Ionicons color={colors.textSecondary} name="construct-outline" size={16} />
            <Text style={styles.hint}>{t('appearance.themeSoon')}</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing[24], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  section: { gap: spacing[8] },
  sectionTitle: { ...typography.label, color: colors.text },
  hint: { ...typography.caption, color: colors.textSecondary, flexShrink: 1 },
  themeRow: { backgroundColor: colors.surfaceMuted, borderRadius: radius.radiusMedium, flexDirection: 'row', gap: spacing[4], padding: spacing[4] },
  disabled: { opacity: 0.5 },
  themeOption: { alignItems: 'center', borderRadius: radius.radiusSmall, flex: 1, paddingVertical: spacing[8] },
  themeSelected: { backgroundColor: colors.white },
  themeLabel: { ...typography.bodySmall, color: colors.textSecondary, fontWeight: '600' },
  themeLabelSelected: { color: colors.primary },
  soon: { alignItems: 'center', flexDirection: 'row', gap: spacing[8] },
});
