import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { MetaAiBadge } from '@/components/ai/MetaAiBadge';
import { TextField } from '@/components/forms/TextField';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { type InstitutionResult, membershipService, useMembership } from '@/services/membershipService';
import { errorMessage } from '@/utils/format';

const MIN_QUERY = 3;
const SEARCH_DELAY_MS = 300;

/**
 * Choose your institution (after the first login, and Profile → Institution). The list is never
 * shown in full: matches appear only after 3 letters. Then the user verifies it with their
 * student card, or asks for their institution to be added.
 */
export default function InstitutionScreen() {
  const { t } = useTranslation();
  const membership = useMembership();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<InstitutionResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    void membershipService.refresh().catch(() => undefined);
  }, []);

  // Fewer than 3 letters: no results are shown (and none are fetched).
  const tooShort = query.trim().length < MIN_QUERY;
  useEffect(() => {
    const text = query.trim();
    if (text.length < MIN_QUERY) return;
    let active = true;
    const timer = setTimeout(() => {
      setSearching(true);
      membershipService.search(text)
        .then((found) => { if (active) setResults(found); })
        .catch((searchError) => { if (active) setError(errorMessage(searchError, t('institution.searchFailed'))); })
        .finally(() => { if (active) setSearching(false); });
    }, SEARCH_DELAY_MS);
    return () => { active = false; clearTimeout(timer); };
  }, [query, t]);

  const choose = async (institution: InstitutionResult) => {
    setBusy(institution.id);
    setError(null);
    try {
      await membershipService.choose(institution.id);
      setQuery('');
      setChanging(false);
    } catch (chooseError) {
      setError(errorMessage(chooseError, t('institution.chooseFailed')));
    } finally {
      setBusy(null);
    }
  };

  if (!membership) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ActivityIndicator color={colors.primary} style={styles.loading} />
      </SafeAreaView>
    );
  }

  const status = membership.status;
  const showSearch = status === 'none' || (changing && status !== 'verified');

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ScreenHeader kicker={t('institution.kicker')} subtitle={t('institution.subtitle')} title={t('institution.title')} />

        {membership.institution ? (
          <View style={[styles.statusCard, status === 'verified' && styles.statusVerified]}>
            <Ionicons
              color={status === 'verified' ? colors.success : colors.primary}
              name={status === 'verified' ? 'shield-checkmark' : status === 'review' ? 'hourglass-outline' : 'school-outline'}
              size={28}
            />
            <View style={styles.statusText}>
              <Text style={styles.statusName}>{membership.institution.nombre}</Text>
              <Text style={styles.statusLine}>{t(`institution.status.${status}`)}</Text>
              {status === 'verified' && membership.method ? <Text style={styles.muted}>{t(`institution.method.${membership.method}`)}</Text> : null}
            </View>
          </View>
        ) : null}

        {status === 'pending' || status === 'review' ? (
          <>
            {membership.lastCheck?.decision === 'retry' ? (
              <Notice tone="warning">
                {/* A reviewer's rejection says why; an automatic retry asks for a sharper photo. */}
                {membership.lastCheck.reasons?.includes('review_rejected')
                  ? t('institution.reviewRejected', { reason: t(`institution.reviewReasons.${membership.lastCheck.reasons.find((r) => r.startsWith('review_') && r !== 'review_rejected')?.slice(7) ?? 'unclear'}`) })
                  : t('institution.retryHint')}
              </Notice>
            ) : null}
            {status === 'review' ? <Notice tone="info">{t('institution.reviewHint')}</Notice> : null}
            <View style={styles.verifyCard}>
              <Text style={styles.sectionTitle}>{t('institution.verifyTitle')}</Text>
              <Text style={styles.muted}>{t('institution.verifyText')}</Text>
              <MetaAiBadge feature="studentCard" />
              <ButtonPrimary icon="card-outline" onPress={() => router.push('/student-card')} title={t('institution.verifyWithCard')} />
              <ButtonSecondary icon="document-text-outline" onPress={() => router.push('/student-document')} title={t('studentDocument.entry')} />
            </View>
            {!changing ? <ButtonSecondary onPress={() => setChanging(true)} title={t('institution.change')} /> : null}
          </>
        ) : null}

        {status === 'verified' ? <Notice tone="success">{t('institution.verifiedHint')}</Notice> : null}

        {showSearch ? (
          <View style={styles.search}>
            <TextField
              autoCapitalize="none"
              autoCorrect={false}
              hint={t('institution.searchHint')}
              label={t('institution.searchLabel')}
              onChangeText={setQuery}
              placeholder={t('institution.searchPlaceholder')}
              value={query}
            />
            {searching ? <ActivityIndicator color={colors.primary} /> : null}
            {results && !searching && !tooShort ? (
              results.length ? results.map((institution) => (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy !== null}
                  key={institution.id}
                  onPress={() => void choose(institution)}
                  style={({ pressed }) => [styles.result, pressed && styles.resultPressed]}
                >
                  <View style={styles.statusText}>
                    <Text style={styles.resultName}>{institution.nombre}</Text>
                    <Text style={styles.muted}>{[institution.nombre_corto, institution.ciudad].filter(Boolean).join(' · ')}</Text>
                  </View>
                  {busy === institution.id ? <ActivityIndicator color={colors.primary} /> : <Ionicons color={colors.primary} name="chevron-forward" size={20} />}
                </Pressable>
              )) : <Text style={styles.muted}>{t('institution.noResults')}</Text>
            ) : null}
          </View>
        ) : null}

        {error ? <Notice tone="error">{error}</Notice> : null}

        {status !== 'verified' ? (
          membership.request?.estado === 'pendiente' ? (
            <Notice tone="info">{t('institution.requestPending', { name: membership.request.nombre })}</Notice>
          ) : (
            <ButtonSecondary icon="add-circle-outline" onPress={() => router.push('/institution-request')} title={t('institution.notListed')} />
          )
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  loading: { marginTop: spacing[40] },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  statusCard: { alignItems: 'center', backgroundColor: colors.primaryLight, borderRadius: radius.radiusLarge, flexDirection: 'row', gap: spacing[12], padding: spacing[16] },
  statusVerified: { backgroundColor: '#ECFDF3' },
  statusText: { flex: 1, gap: 2 },
  statusName: { ...typography.bodyMedium, color: colors.text, fontWeight: '700' },
  statusLine: { ...typography.bodySmall, color: colors.text },
  muted: { ...typography.bodySmall, color: colors.textSecondary },
  verifyCard: { backgroundColor: colors.white, borderColor: colors.border, borderRadius: radius.radiusLarge, borderWidth: 1, gap: spacing[8], padding: spacing[16] },
  sectionTitle: { ...typography.bodyMedium, color: colors.text, fontWeight: '700' },
  search: { gap: spacing[8] },
  result: { alignItems: 'center', backgroundColor: colors.white, borderColor: colors.border, borderRadius: radius.radiusMedium, borderWidth: 1, flexDirection: 'row', gap: spacing[8], minHeight: 56, padding: spacing[12] },
  resultPressed: { opacity: 0.7 },
  resultName: { ...typography.bodyMedium, color: colors.text, fontWeight: '600' },
});
