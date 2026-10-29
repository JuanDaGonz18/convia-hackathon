import { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, type NativeSyntheticEvent, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, type TextInputKeyPressEventData, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { MetaAiBadge } from '@/components/ai/MetaAiBadge';
import { DemoDisabledNote, useDemoAccount } from '@/components/demo/DemoDisabledNote';
import { FaceVerificationModal } from '@/components/face/FaceVerificationModal';
import { VerifyInstitutionCard } from '@/components/institution/VerifyInstitutionCard';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { currentLanguage } from '@/i18n';
import { type AgentOption, type AgentProgress, type AgentResult, agentService } from '@/services/agentService';
import { useMembership } from '@/services/membershipService';
import { useAppStore } from '@/store/appStore';
import { errorMessage, formatPrice } from '@/utils/format';

const STEPS: AgentProgress[] = ['understanding', 'searching', 'checking', 'verifying'];
type StepState = 'pending' | 'active' | 'done';
type Turn = { id: number; question: string; result: AgentResult | null; error: string | null; steps: Record<AgentProgress, StepState> };

const freshSteps = (): Record<AgentProgress, StepState> => ({ understanding: 'active', searching: 'pending', checking: 'pending', verifying: 'pending' });

function OptionCard({ option, t }: Readonly<{ option: AgentOption; t: ReturnType<typeof useTranslation>['t'] }>) {
  return (
    <View style={[styles.option, option.verified ? styles.optionVerified : styles.optionUnverified]}>
      <View style={styles.optionHeader}>
        <Text style={styles.optionTime}>{option.departure.slice(11)}</Text>
        <Text style={[styles.tag, option.verified ? styles.tagVerified : styles.tagUnverified]}>{t(option.verified ? 'assistant.verified' : 'assistant.unverified')}</Text>
      </View>
      <Text style={styles.optionRoute}>{option.from} → {option.to}</Text>
      <Text style={styles.muted}>
        {[option.departure.slice(0, 10), option.driver_first_name, option.vehicle ? `${option.vehicle.brand} · ${option.vehicle.color} · ${option.vehicle.plate_masked}` : null].filter(Boolean).join(' · ')}
      </Text>
      <Text style={styles.muted}>{t('assistant.seatsLeft', { count: option.seats_left })} · {formatPrice(option.price_cop)}</Text>
    </View>
  );
}

/**
 * "Asistente": the passenger writes where they need to go; the agent (Muse Spark Open on open
 * weights) understands, searches, picks and verifies a trip, and proposes it. The user's Confirm
 * (after the usual face check) is the final approval. Every run has its trace.
 */
export default function AssistantScreen() {
  const { t } = useTranslation();
  const membership = useMembership();
  const demo = useDemoAccount();
  const userId = useAppStore((state) => state.currentUser?.id ?? null);
  const [text, setText] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<{ runId: string; hash: string } | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const nextId = useRef(1);

  const update = (id: number, change: (turn: Turn) => Turn) => setTurns((all) => all.map((turn) => (turn.id === id ? change(turn) : turn)));

  // Web: Enter sends, Shift+Enter adds a line. Phones keep the return key for new lines and send with the button.
  const onWebKeyPress = (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const key = event.nativeEvent as TextInputKeyPressEventData & { shiftKey?: boolean; isComposing?: boolean };
    if (key.key !== 'Enter' || key.shiftKey || key.isComposing) return;
    event.preventDefault();
    void ask(text);
  };

  const ask = async (question: string) => {
    const clean = question.trim();
    if (!clean || busy) return;
    const id = nextId.current++;
    setText('');
    setBusy(true);
    setConfirmed(null);
    setConfirmError(null);
    setTurns((all) => [...all, { id, question: clean, result: null, error: null, steps: freshSteps() }]);
    try {
      const result = await agentService.ask(clean, currentLanguage(), (step, status) => update(id, (turn) => ({ ...turn, steps: { ...turn.steps, [step]: status === 'done' ? 'done' : 'active' } })));
      update(id, (turn) => ({ ...turn, result }));
    } catch (askError) {
      update(id, (turn) => ({ ...turn, error: errorMessage(askError, t('assistant.failed')) }));
    } finally {
      setBusy(false);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    }
  };

  const confirm = async () => {
    if (!confirming) return;
    const { runId, hash } = confirming;
    setConfirming(null);
    try {
      await agentService.confirm(runId, hash);
      setConfirmed(runId);
    } catch (confirmFailure) {
      const code = confirmFailure instanceof Error ? confirmFailure.message : '';
      setConfirmError(code === 'PROPOSAL_STALE' ? t('assistant.stale') : errorMessage(confirmFailure, t('assistant.confirmFailed')));
    }
  };

  if (membership && membership.status !== 'verified') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <ScreenHeader kicker={t('assistant.kicker')} title={t('assistant.title')} />
          <VerifyInstitutionCard />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      {userId ? (
        <FaceVerificationModal onClose={() => setConfirming(null)} onFailure={() => undefined} onSuccess={() => void confirm()} trigger="trip_request" userId={userId} visible={!!confirming} />
      ) : null}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" ref={scroll}>
          <ScreenHeader kicker={t('assistant.kicker')} subtitle={t('assistant.subtitle')} title={t('assistant.title')} />
          <MetaAiBadge feature="agent" model="Muse Spark Open" />

          {!turns.length ? (
            <View style={styles.examples}>
              <Text style={styles.muted}>{t('assistant.examplesTitle')}</Text>
              {(['example1', 'example2'] as const).map((key) => (
                <Pressable accessibilityRole="button" key={key} onPress={() => void ask(t(`assistant.${key}`))} style={styles.example}>
                  <Ionicons color={colors.primary} name="chatbubble-ellipses-outline" size={16} />
                  <Text style={styles.exampleText}>{t(`assistant.${key}`)}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {turns.map((turn) => (
            <View key={turn.id} style={styles.turn}>
              <View style={styles.userBubble}><Text style={styles.userText}>{turn.question}</Text></View>

              {!turn.result && !turn.error ? (
                <View style={styles.progress}>
                  {STEPS.map((step) => (
                    <View key={step} style={styles.progressRow}>
                      {turn.steps[step] === 'done'
                        ? <Ionicons color={colors.success} name="checkmark-circle" size={18} />
                        : turn.steps[step] === 'active' ? <ActivityIndicator color={colors.primary} size="small" /> : <Ionicons color={colors.border} name="ellipse-outline" size={18} />}
                      <Text style={[styles.progressText, turn.steps[step] === 'pending' && styles.mutedText]}>{t(`assistant.progress.${step}`)}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {turn.error ? <Notice tone="error">{turn.error}</Notice> : null}

              {turn.result ? (
                <View style={styles.agentBubble}>
                  {turn.result.spec ? (
                    <Text style={styles.spec}>
                      {t('assistant.understood', {
                        from: turn.result.spec.origin?.label ?? t('assistant.anywhere'),
                        to: turn.result.spec.destination.label,
                        when: `${turn.result.spec.date} ${turn.result.spec.time} ±${turn.result.spec.flex_minutes} min`,
                        seats: turn.result.spec.seats,
                      })}
                    </Text>
                  ) : null}
                  {turn.result.reply ? <Text style={styles.agentText}>{turn.result.reply}</Text> : null}
                  {turn.result.options.map((option) => <OptionCard key={option.trip_id} option={option} t={t} />)}

                  {turn.result.status === 'proposed' && turn.result.proposal && turn.result.run_id ? (
                    confirmed === turn.result.run_id ? (
                      <>
                        <Notice tone="success">{t('assistant.requested')}</Notice>
                        <ButtonSecondary onPress={() => router.push('/requests')} title={t('assistant.seeRequests')} />
                      </>
                    ) : (
                      <>
                        <ButtonPrimary
                          disabled={demo}
                          icon="checkmark-circle-outline"
                          onPress={() => setConfirming({ runId: turn.result!.run_id!, hash: turn.result!.proposal!.hash })}
                          title={t('assistant.confirm', { price: formatPrice(turn.result.proposal.price_cop) })}
                        />
                        {demo ? <DemoDisabledNote /> : <Text style={styles.muted}>{t('assistant.confirmHint')}</Text>}
                      </>
                    )
                  ) : null}
                  {confirmError && turn.result.status === 'proposed' ? <Notice tone="warning">{confirmError}</Notice> : null}

                  {turn.result.run_id ? (
                    <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/agent-trace', params: { runId: turn.result!.run_id! } })} style={styles.traceLink}>
                      <Ionicons color={colors.primary} name="git-branch-outline" size={16} />
                      <Text style={styles.traceText}>{t('assistant.howDecided')}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          ))}
        </ScrollView>

        <View style={styles.inputBar}>
          <TextInput
            editable={!busy}
            multiline
            onChangeText={setText}
            onKeyPress={Platform.OS === 'web' ? onWebKeyPress : undefined}
            onSubmitEditing={() => void ask(text)}
            placeholder={t('assistant.placeholder')}
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
            value={text}
          />
          <Pressable accessibilityLabel={t('assistant.send')} accessibilityRole="button" disabled={busy || !text.trim()} onPress={() => void ask(text)} style={[styles.send, (busy || !text.trim()) && styles.sendDisabled]}>
            {busy ? <ActivityIndicator color={colors.white} size="small" /> : <Ionicons color={colors.white} name="arrow-up" size={20} />}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  flex: { flex: 1 },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[24] },
  examples: { gap: spacing[8] },
  example: { alignItems: 'center', backgroundColor: colors.primaryLight, borderRadius: radius.radiusMedium, flexDirection: 'row', gap: spacing[8], minHeight: 44, padding: spacing[12] },
  exampleText: { ...typography.bodySmall, color: colors.text, flex: 1 },
  turn: { gap: spacing[8] },
  userBubble: { alignSelf: 'flex-end', backgroundColor: colors.primary, borderRadius: radius.radiusLarge, maxWidth: '85%', paddingHorizontal: spacing[12], paddingVertical: spacing[8] },
  userText: { ...typography.bodySmall, color: colors.white },
  progress: { backgroundColor: colors.surfaceMuted, borderRadius: radius.radiusLarge, gap: spacing[8], padding: spacing[12] },
  progressRow: { alignItems: 'center', flexDirection: 'row', gap: spacing[8] },
  progressText: { ...typography.bodySmall, color: colors.text },
  mutedText: { color: colors.textSecondary },
  agentBubble: { backgroundColor: colors.white, borderColor: colors.border, borderRadius: radius.radiusLarge, borderWidth: 1, gap: spacing[8], padding: spacing[12] },
  spec: { ...typography.caption, color: colors.textSecondary },
  agentText: { ...typography.bodyMedium, color: colors.text },
  option: { borderRadius: radius.radiusMedium, borderWidth: 1, gap: 2, padding: spacing[12] },
  optionVerified: { backgroundColor: '#ECFDF3', borderColor: colors.success },
  optionUnverified: { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderStyle: 'dashed' },
  optionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  optionTime: { ...typography.headingM, color: colors.text },
  optionRoute: { ...typography.bodySmall, color: colors.text, fontWeight: '600' },
  tag: { ...typography.caption, borderRadius: radius.radiusFull, fontWeight: '700', overflow: 'hidden', paddingHorizontal: spacing[8], paddingVertical: 2 },
  tagVerified: { backgroundColor: colors.success, color: colors.white },
  tagUnverified: { backgroundColor: colors.border, color: colors.text },
  muted: { ...typography.caption, color: colors.textSecondary },
  traceLink: { alignItems: 'center', flexDirection: 'row', gap: spacing[4], paddingVertical: spacing[4] },
  traceText: { ...typography.bodySmall, color: colors.primary, fontWeight: '600' },
  inputBar: { alignItems: 'flex-end', backgroundColor: colors.white, borderColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: spacing[8], padding: spacing[12] },
  input: { ...typography.bodySmall, backgroundColor: colors.surfaceMuted, borderRadius: radius.radiusLarge, color: colors.text, flex: 1, maxHeight: 120, minHeight: 44, paddingHorizontal: spacing[12], paddingVertical: spacing[12] },
  send: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 22, height: 44, justifyContent: 'center', width: 44 },
  sendDisabled: { opacity: 0.5 },
});
