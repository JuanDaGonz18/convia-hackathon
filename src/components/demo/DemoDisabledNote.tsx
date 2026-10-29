import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { useAppStore } from '@/store/appStore';
import { isDemoAccount } from '@/utils/demoAccount';

/** True for the judges' shared demo accounts, whose destructive actions are shown but disabled. */
export function useDemoAccount() {
  return useAppStore((state) => isDemoAccount(state.currentUser?.email));
}

/**
 * Under a disabled action on a demo account: the judges see the real screen, but can't
 * cancel, delete or lock others out of the shared demo. `sample`: the result came from a sample video.
 */
export function DemoDisabledNote({ sample = false }: Readonly<{ sample?: boolean }>) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <Ionicons color={colors.textSecondary} name="lock-closed-outline" size={14} />
      <Text style={styles.text}>{t(sample ? 'demo.disabledSample' : 'demo.disabled')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing[4], justifyContent: 'center' },
  text: { ...typography.caption, color: colors.textSecondary },
});
