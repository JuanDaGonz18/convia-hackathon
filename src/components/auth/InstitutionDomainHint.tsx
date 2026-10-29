import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { isSupabaseEnabled } from '@/lib/supabase';
import { type Institution, institutionService } from '@/services/institutionService';
import { emailDomain } from '@/utils/emailDomain';

/** Wait this long after the last keystroke before asking the server. */
const CHECK_DELAY_MS = 500;
/** Darker than colors.success so small text stays readable (same as Notice). */
const SUCCESS_TEXT = '#067647';

type Check =
  | { domain: string; status: 'checking' }
  | { domain: string; status: 'allowed'; institution: Institution }
  | { domain: string; status: 'blocked' }
  | { domain: string; status: 'error' };

/**
 * Under the sign-up e-mail field: says whether the domain belongs to an
 * enabled institution as the user types. Any e-mail can sign up: an
 * institutional one is verified at once, any other chooses and verifies its
 * institution after logging in. The list of institutions is never shown.
 */
export function InstitutionDomainHint({ email }: Readonly<{ email: string }>) {
  const { t } = useTranslation();
  const [check, setCheck] = useState<Check | null>(null);
  const domain = emailDomain(email);

  useEffect(() => {
    if (!domain || !isSupabaseEnabled) return;
    let active = true;
    const timer = setTimeout(() => {
      setCheck({ domain, status: 'checking' });
      institutionService.findByEmail(email.trim())
        .then((institution) => active && setCheck(institution ? { domain, status: 'allowed', institution } : { domain, status: 'blocked' }))
        .catch(() => active && setCheck({ domain, status: 'error' }));
    }, CHECK_DELAY_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // Only a different domain needs a new check, not every keystroke before the "@".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain]);

  // A result for an older domain is not shown.
  const current = check && check.domain === domain ? check : null;

  return (
    <View accessibilityLiveRegion="polite" style={styles.container}>
      {current?.status === 'checking' ? (
        <View style={styles.row}>
          <ActivityIndicator color={colors.primary} size="small" />
          <Text style={styles.muted}>{t('institutions.checking')}</Text>
        </View>
      ) : current?.status === 'allowed' ? (
        <View style={styles.row}>
          <Ionicons color={SUCCESS_TEXT} name="checkmark-circle" size={16} />
          <Text style={styles.allowed}>{t('institutions.allowed', { name: current.institution.name })}</Text>
        </View>
      ) : current?.status === 'blocked' ? (
        <View style={styles.row}>
          <Ionicons color={colors.textSecondary} name="information-circle-outline" size={16} />
          <Text style={styles.muted}>{t('institutions.openSignup')}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing[4], marginTop: -spacing[8] },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing[4] },
  muted: { ...typography.caption, color: colors.textSecondary, flexShrink: 1 },
  allowed: { ...typography.caption, color: SUCCESS_TEXT, flexShrink: 1, fontWeight: '600' },
});
