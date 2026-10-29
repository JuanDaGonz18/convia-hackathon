import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { MetaAiBadge } from '@/components/ai/MetaAiBadge';
import { useSilentCamera } from '@/components/camera/SilentCamera';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { analyzeStudentCard } from '@/services/faceRecognition';
import { membershipService, type StudentCardDecision } from '@/services/membershipService';
import { errorMessage } from '@/utils/format';

type Phase = { kind: 'idle' } | { kind: 'working'; step: 'face' | 'reading' } | { kind: 'done'; decision: StudentCardDecision; reasons: string[] };

/**
 * Verify the chosen institution with a student card. On the phone (or in the browser) the
 * card's face is found, compared with the user's selfie, and left out: only crops of the card
 * around it are sent, and Muse Spark reads institution, name and expiry from them. Any doubt
 * → manual review; an unreadable photo → try again.
 */
export default function StudentCardScreen() {
  const { t } = useTranslation();
  const { takePhoto, cameraModal } = useSilentCamera({ quality: 0.9 });
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);

  const check = async (uri: string) => {
    setError(null);
    setPhase({ kind: 'working', step: 'face' });
    try {
      const analysis = await analyzeStudentCard(uri);
      let crops: string[] = [];
      if (analysis.ok) {
        await membershipService.submitCardFace(analysis.embedding);
        crops = analysis.crops;
      }
      setPhase({ kind: 'working', step: 'reading' });
      const result = await membershipService.verifyCard(crops);
      setPhase({ kind: 'done', decision: result.decision, reasons: result.reasons });
    } catch (checkError) {
      setPhase({ kind: 'idle' });
      setError(errorMessage(checkError, t('studentCard.failed')));
    }
  };

  const pick = async (source: 'camera' | 'library') => {
    const picked = source === 'camera'
      ? await takePhoto()
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9, exif: false });
    const uri = picked.canceled ? null : picked.assets?.[0]?.uri;
    if (uri) await check(uri);
  };

  const working = phase.kind === 'working';

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader kicker={t('institution.kicker')} subtitle={t('studentCard.subtitle')} title={t('studentCard.title')} />
        <MetaAiBadge feature="studentCard" />

        {phase.kind !== 'done' ? (
          <>
            <View style={styles.tips}>
              {(['flat', 'light', 'whole', 'privacy'] as const).map((tip) => (
                <View key={tip} style={styles.tip}>
                  <Ionicons color={colors.primary} name={tip === 'privacy' ? 'lock-closed-outline' : 'checkmark-circle-outline'} size={18} />
                  <Text style={styles.tipText}>{t(`studentCard.tips.${tip}`)}</Text>
                </View>
              ))}
            </View>
            {working ? (
              <View style={styles.working}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.tipText}>{t(phase.step === 'face' ? 'studentCard.stepFace' : 'studentCard.stepReading')}</Text>
              </View>
            ) : (
              <>
                <ButtonPrimary icon="camera" onPress={() => void pick('camera')} title={t('studentCard.takePhoto')} />
                <ButtonSecondary icon="images-outline" onPress={() => void pick('library')} title={t('studentCard.fromGallery')} />
                <ButtonSecondary icon="document-text-outline" onPress={() => router.push('/student-document')} title={t('studentDocument.entry')} />
              </>
            )}
          </>
        ) : (
          <View style={styles.result}>
            <Ionicons
              color={phase.decision === 'verified' ? colors.success : phase.decision === 'review' ? colors.primary : colors.warning}
              name={phase.decision === 'verified' ? 'shield-checkmark' : phase.decision === 'review' ? 'hourglass-outline' : 'refresh-circle-outline'}
              size={56}
            />
            <Text style={styles.resultTitle}>{t(`studentCard.result.${phase.decision}.title`)}</Text>
            <Text style={styles.resultText}>{t(`studentCard.result.${phase.decision}.text`)}</Text>
            {phase.reasons.length && phase.decision !== 'verified' ? (
              <View style={styles.reasons}>
                {phase.reasons.map((reason) => <Text key={reason} style={styles.reason}>• {t(`studentCard.reasons.${reason}`, { defaultValue: reason })}</Text>)}
              </View>
            ) : null}
            {phase.decision === 'retry'
              ? <ButtonPrimary onPress={() => setPhase({ kind: 'idle' })} title={t('studentCard.tryAgain')} />
              : <ButtonPrimary onPress={() => router.replace('/(tabs)')} title={t('studentCard.done')} />}
          </View>
        )}

        {error ? <Notice tone="error">{error}</Notice> : null}
      </ScrollView>
      {cameraModal}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  tips: { backgroundColor: colors.surfaceMuted, borderRadius: radius.radiusLarge, gap: spacing[8], padding: spacing[16] },
  tip: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing[8] },
  tipText: { ...typography.bodySmall, color: colors.text, flex: 1 },
  working: { alignItems: 'center', flexDirection: 'row', gap: spacing[12], padding: spacing[16] },
  result: { alignItems: 'center', gap: spacing[12], paddingVertical: spacing[16] },
  resultTitle: { ...typography.headingM, color: colors.text, fontWeight: '700', textAlign: 'center' },
  resultText: { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center' },
  reasons: { alignSelf: 'stretch', gap: spacing[4] },
  reason: { ...typography.bodySmall, color: colors.text },
});
