import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { type AgentStep, agentService } from '@/services/agentService';
import { errorMessage } from '@/utils/format';

/** One line about what a tool returned (the full JSON stays in the database). */
function summary(step: AgentStep, t: ReturnType<typeof useTranslation>['t']): string {
  const result = (step.result ?? {}) as Record<string, unknown>;
  if (result.error && typeof result.error === 'object') return `${(result.error as { code?: string }).code}: ${(result.error as { message?: string }).message}`;
  switch (step.tool_name) {
    case 'resolve_place': {
      // One line per place asked (older runs stored a single place at the top level).
      type Place = { query?: string; ambiguous?: boolean; candidates?: { ref: string; label: string }[]; already_resolved?: { ref: string; label: string }[] };
      const places = (result.results as Place[] | undefined) ?? [result as Place];
      return places.map((place) => {
        const found = place.candidates ?? place.already_resolved ?? [];
        return found.length ? found.map((c) => `${c.ref} ${c.label}`).join(' · ') + (place.ambiguous ? ` (${t('agentTrace.ambiguous')})` : '') : `${place.query ?? ''} — ${t('agentTrace.noPlace')}`;
      }).join('\n');
    }
    case 'submit_request_spec':
      return result.accepted ? t('agentTrace.specAccepted') : `${t('agentTrace.specRejected')}: ${((result.errors as string[]) ?? []).join(' · ')}`;
    case 'search_trips': {
      const options = (result.options as { trip_id: string; departure: string; level: string }[] | undefined) ?? [];
      return options.length ? t('agentTrace.options', { count: options.length, first: `${options[0].departure.slice(11)} (${options[0].level})` }) : t('agentTrace.noOptions');
    }
    case 'propose_request_seat':
      return result.verified ? `${t('agentTrace.verified')}: ${((result.checks as string[]) ?? []).join(' · ')}` : `${t('agentTrace.notVerified')}: ${((result.failures as string[]) ?? []).join(' · ')}`;
    case 'judge': {
      const claims = (result.claims as { text: string; supported: boolean }[] | undefined) ?? [];
      return claims.map((claim) => `${claim.supported ? '✓' : '✗'} ${claim.text}`).join('\n') || (step.error ?? '');
    }
    default:
      return result.ended ? t('agentTrace.ended', { status: String(result.ended) }) : '';
  }
}

/**
 * "How the agent decided": every turn of a run, for users and judges. Model turns show the
 * provider, the model the provider said it ran (Muse Spark Open, open weights) and its request
 * id; tool steps show the plan note, the result and every check that passed or failed.
 */
export default function AgentTraceScreen() {
  const { t } = useTranslation();
  const { runId } = useLocalSearchParams<{ runId?: string }>();
  const [steps, setSteps] = useState<AgentStep[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    agentService.trace(runId).then(setSteps).catch((traceError) => setError(errorMessage(traceError, t('agentTrace.failed'))));
  }, [runId, t]);

  const models = (steps ?? []).filter((step) => step.kind === 'model');
  const cost = (steps ?? []).reduce((sum, step) => sum + (step.cost_usd ?? 0), 0);
  const time = (steps ?? []).reduce((sum, step) => sum + (step.latency_ms ?? 0), 0);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader kicker={t('assistant.kicker')} subtitle={t('agentTrace.subtitle')} title={t('agentTrace.title')} />
        {error ? <Notice tone="error">{error}</Notice> : null}
        {!steps && !error ? <ActivityIndicator color={colors.primary} /> : null}

        {steps ? (
          <View style={styles.totals}>
            <Text style={styles.totalsText}>{t('agentTrace.totals', { turns: models.length, seconds: (time / 1000).toFixed(1), cost: cost.toFixed(4) })}</Text>
            {models[0]?.model ? <Text style={styles.muted}>{`${models[0].model} · ${models[0].provider}`}</Text> : null}
          </View>
        ) : null}

        {(steps ?? []).map((step) => {
          const failed = !!step.error;
          if (step.kind === 'model') {
            return (
              <View key={step.n} style={styles.modelRow}>
                <Ionicons color={failed ? colors.error : colors.primary} name="sparkles-outline" size={16} />
                <View style={styles.flex}>
                  <Text style={styles.plan}>{step.plan ?? (failed ? step.error : '')}</Text>
                  <Text style={styles.muted}>
                    {[step.provider, step.model, step.request_id ? `req …${step.request_id.slice(-10)}` : null, step.latency_ms ? `${step.latency_ms} ms` : null, step.cost_usd ? `$${step.cost_usd.toFixed(4)}` : null].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </View>
            );
          }
          return (
            <View key={step.n} style={[styles.toolRow, failed && styles.toolFailed, step.kind === 'judge' && styles.judgeRow]}>
              <View style={styles.toolHeader}>
                <Ionicons color={failed ? colors.error : colors.success} name={failed ? 'close-circle' : 'checkmark-circle'} size={16} />
                <Text style={styles.toolName}>{step.kind === 'judge' ? t('agentTrace.judge') : step.tool_name}</Text>
                {step.latency_ms !== null ? <Text style={styles.muted}>{step.latency_ms} ms</Text> : null}
              </View>
              <Text style={styles.summary}>{summary(step, t)}</Text>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  flex: { flex: 1 },
  content: { gap: spacing[8], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  totals: { backgroundColor: colors.primaryLight, borderRadius: radius.radiusMedium, gap: 2, padding: spacing[12] },
  totalsText: { ...typography.bodySmall, color: colors.text, fontWeight: '600' },
  modelRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing[8], paddingTop: spacing[8] },
  plan: { ...typography.bodySmall, color: colors.text, fontStyle: 'italic' },
  muted: { ...typography.caption, color: colors.textSecondary },
  toolRow: { backgroundColor: colors.white, borderColor: colors.border, borderRadius: radius.radiusMedium, borderWidth: 1, gap: spacing[4], marginLeft: spacing[24], padding: spacing[8] },
  toolFailed: { borderColor: colors.error },
  judgeRow: { backgroundColor: '#EEF2FF' },
  toolHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing[4] },
  toolName: { ...typography.caption, color: colors.text, flex: 1, fontWeight: '700' },
  summary: { ...typography.caption, color: colors.text },
});
