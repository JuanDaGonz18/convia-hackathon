import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { MetaAiBadge } from '@/components/ai/MetaAiBadge';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { inspectDocumentImage } from '@/services/faceRecognition';
import { membershipService, type StudentCardDecision } from '@/services/membershipService';
import { errorMessage } from '@/utils/format';

type Slot = 'card' | 'screenshot';
type Picked = { jpegBase64: string };

/**
 * "My student card has no photo": the card's front plus a screenshot of the institutional account
 * (Teams, Outlook or the student portal), cropped to name and e-mail. Each image is checked on the
 * device first: one with a face is not sent. Muse Spark reads both and code compares, but a person
 * always approves this path (screenshots are easy to fake).
 */
export default function StudentDocumentScreen() {
  const { t } = useTranslation();
  const [images, setImages] = useState<Partial<Record<Slot, Picked>>>({});
  const [checking, setChecking] = useState<Slot | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ decision: StudentCardDecision; reasons: string[] } | null>(null);

  const pick = async (slot: Slot) => {
    setError(null);
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9, exif: false });
    const uri = picked.canceled ? null : picked.assets?.[0]?.uri;
    if (!uri) return;
    setChecking(slot);
    try {
      const inspected = await inspectDocumentImage(uri);
      // A face means the image must not be sent: a card with a photo goes through the other path,
      // a screenshot with a profile picture must be cropped first.
      if (inspected.faceCount > 0) {
        setImages((current) => ({ ...current, [slot]: undefined }));
        setError(t(slot === 'card' ? 'studentDocument.cardHasFace' : 'studentDocument.screenshotHasFace'));
        return;
      }
      setImages((current) => ({ ...current, [slot]: { jpegBase64: inspected.jpegBase64 } }));
    } catch (inspectError) {
      setError(errorMessage(inspectError, t('studentDocument.imageFailed')));
    } finally {
      setChecking(null);
    }
  };

  const send = async () => {
    if (!images.card || !images.screenshot) return;
    setSending(true);
    setError(null);
    try {
      setResult(await membershipService.verifyDocument(images.card.jpegBase64, images.screenshot.jpegBase64));
    } catch (sendError) {
      setError(errorMessage(sendError, t('studentDocument.failed')));
    } finally {
      setSending(false);
    }
  };

  if (result) {
    const retry = result.decision === 'retry';
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <ScreenHeader kicker={t('institution.kicker')} title={t('studentDocument.title')} />
          <View style={styles.result}>
            <Ionicons color={retry ? colors.warning : colors.primary} name={retry ? 'refresh-circle-outline' : 'hourglass-outline'} size={56} />
            <Text style={styles.resultTitle}>{t(retry ? 'studentDocument.retryTitle' : 'studentDocument.reviewTitle')}</Text>
            <Text style={styles.resultText}>{t(retry ? 'studentDocument.retryText' : 'studentDocument.reviewText')}</Text>
            {!retry && result.reasons.length ? (
              <View style={styles.reasons}>
                <Text style={styles.reasonsTitle}>{t('studentDocument.reviewerNotes')}</Text>
                {result.reasons.map((reason) => <Text key={reason} style={styles.reason}>• {t(`studentCard.reasons.${reason}`, { defaultValue: reason })}</Text>)}
              </View>
            ) : null}
            {retry
              ? <ButtonPrimary onPress={() => { setResult(null); setImages({}); }} title={t('studentCard.tryAgain')} />
              : <ButtonPrimary onPress={() => router.replace('/(tabs)')} title={t('studentCard.done')} />}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const slot = (key: Slot, icon: 'card-outline' | 'person-circle-outline') => (
    <Pressable
      accessibilityRole="button"
      disabled={checking !== null || sending}
      onPress={() => void pick(key)}
      style={({ pressed }) => [styles.slot, images[key] && styles.slotDone, pressed && styles.slotPressed]}
    >
      <Ionicons color={images[key] ? colors.success : colors.primary} name={images[key] ? 'checkmark-circle' : icon} size={28} />
      <View style={styles.slotText}>
        <Text style={styles.slotTitle}>{t(`studentDocument.${key}Title`)}</Text>
        <Text style={styles.muted}>{t(`studentDocument.${key}Hint`)}</Text>
      </View>
      {checking === key ? <ActivityIndicator color={colors.primary} /> : <Ionicons color={colors.textSecondary} name="chevron-forward" size={18} />}
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader kicker={t('institution.kicker')} subtitle={t('studentDocument.subtitle')} title={t('studentDocument.title')} />
        <MetaAiBadge feature="studentCard" />
        <Notice tone="info">{t('studentDocument.privacy')}</Notice>
        {slot('card', 'card-outline')}
        {slot('screenshot', 'person-circle-outline')}
        {error ? <Notice tone="warning">{error}</Notice> : null}
        <ButtonPrimary disabled={!images.card || !images.screenshot || checking !== null} loading={sending} onPress={() => void send()} title={t('studentDocument.send')} />
        <Text style={styles.muted}>{t('studentDocument.reviewNote')}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  slot: { alignItems: 'center', backgroundColor: colors.white, borderColor: colors.border, borderRadius: radius.radiusLarge, borderWidth: 1, flexDirection: 'row', gap: spacing[12], minHeight: 72, padding: spacing[16] },
  slotDone: { borderColor: colors.success },
  slotPressed: { opacity: 0.7 },
  slotText: { flex: 1, gap: 2 },
  slotTitle: { ...typography.bodyMedium, color: colors.text, fontWeight: '600' },
  muted: { ...typography.bodySmall, color: colors.textSecondary },
  result: { alignItems: 'center', gap: spacing[12], paddingVertical: spacing[16] },
  resultTitle: { ...typography.headingM, color: colors.text, fontWeight: '700', textAlign: 'center' },
  resultText: { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center' },
  reasons: { alignSelf: 'stretch', gap: spacing[4] },
  reasonsTitle: { ...typography.bodySmall, color: colors.text, fontWeight: '600' },
  reason: { ...typography.bodySmall, color: colors.text },
});
