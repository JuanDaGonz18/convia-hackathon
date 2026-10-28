import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { type TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { DemoDisabledNote, useDemoAccount } from '@/components/demo/DemoDisabledNote';
import { SampleClips } from '@/components/pickup/SampleClips';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { toast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { FILMING_TIPS, KNOWN_COLORS, REASONS_WITH_TIPS } from '@/content/pickupVerification';
import i18n from '@/i18n';
import { PICKUP_CLIP_SECONDS, type PickupSample, type PickupStage, type PickupVerification, pickupVerificationService } from '@/services/pickupVerificationService';
import { tripService } from '@/services/tripService';
import { errorMessage } from '@/utils/format';

type Phase = 'camera' | 'recording' | 'processing' | 'result';

/** Which progress row is running for each stage the server reports (rows before it are done). */
const STAGE_STEP: Record<PickupStage, number> = { uploading: 0, analyzing: 1, car_found: 2, plate_found: 3, reading_plate: 3 };

/** Progress rows, in order (pickup.steps.*). */
const STEPS = ['upload', 'car', 'plate', 'read'] as const;

/** A color as Muse Spark or the driver wrote it (Spanish), in the user's language when it is a known one. */
function colorName(t: TFunction, color: string) {
  const word = color.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return (KNOWN_COLORS as readonly string[]).includes(word) ? t(`colors.${word}`) : color.toLowerCase();
}

/** What differs between the car filmed and the trip's car, in one sentence. */
function mismatchDetail(t: TFunction, { reason, plateRead, brandRead, colorRead, vehicle }: PickupVerification) {
  if (!vehicle) return null;
  if (reason === 'plate_mismatch' && plateRead) return t('pickup.mismatch.plate_mismatch', { read: plateRead, expected: vehicle.plate });
  if (reason === 'brand_mismatch' && brandRead) return t('pickup.mismatch.brand_mismatch', { read: brandRead, expected: vehicle.brand });
  if (reason === 'color_mismatch' && colorRead) return t('pickup.mismatch.color_mismatch', { read: colorName(t, colorRead), expected: colorName(t, vehicle.color) });
  return null;
}

/** Retry texts; an unknown code gets the generic one instead of failing. */
function retryKey(reason: string) {
  return i18n.exists(`pickup.retry.${reason}.title`) ? reason : 'server_error';
}

/**
 * "Verificar mi carro" (`?requestId=&tripId=`): the passenger films the arriving
 * car for up to 5 s and verify-pickup says whether it is the trip's car.
 * Nothing is kept: the clip and its frames are deleted after the check.
 */
export default function PickupVerifyScreen() {
  const { t } = useTranslation();
  const { requestId, tripId } = useLocalSearchParams<{ requestId: string; tripId?: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [phase, setPhase] = useState<Phase>('camera');
  const [secondsLeft, setSecondsLeft] = useState(PICKUP_CLIP_SECONDS);
  const [stage, setStage] = useState<PickupStage>('uploading');
  const [result, setResult] = useState<PickupVerification | null>(null);
  const [reported, setReported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const demo = useDemoAccount();
  const [fromSample, setFromSample] = useState(false);

  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = setInterval(() => setSecondsLeft((left) => Math.max(0, left - 1)), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const record = async () => {
    if (!camera.current || !requestId) return;
    setResult(null);
    setReported(false);
    setFromSample(false);
    setSecondsLeft(PICKUP_CLIP_SECONDS);
    setPhase('recording');
    let clipUri: string | undefined;
    try {
      // H.264 everywhere (SAM 3.1 accepts H.264/H.265/MPEG-4); muted, so no microphone is needed.
      const clip = await camera.current.recordAsync({ maxDuration: PICKUP_CLIP_SECONDS, ...(Platform.OS === 'ios' ? { codec: 'avc1' as const } : {}) });
      clipUri = clip?.uri;
    } catch {
      clipUri = undefined;
    }
    if (!clipUri) {
      setResult({ verificationId: null, status: 'retry', reason: 'recording_failed', plateRead: null, confidence: null, brandMatch: null, colorMatch: null, brandRead: null, colorRead: null, vehicle: null, driver: null, mock: false });
      setPhase('result');
      return;
    }
    setPhase('processing');
    setResult(await pickupVerificationService.verify(requestId, clipUri, setStage));
    setPhase('result');
  };

  /** Demo accounts: the same check on a sample clip instead of a filmed one. */
  const trySample = async (sample: PickupSample) => {
    setResult(null);
    setReported(false);
    setFromSample(true);
    setStage('analyzing');
    setPhase('processing');
    setResult(await pickupVerificationService.verifySample(requestId, sample, setStage));
    setPhase('result');
  };

  const report = async () => {
    if (!result?.verificationId) return;
    setBusy(true);
    try {
      await pickupVerificationService.reportMismatch(result.verificationId);
      setReported(true);
      toast.info(t('pickup.mismatch.reported'));
    } catch (reportError) {
      toast.error(errorMessage(reportError, t('pickup.mismatch.reportFailed')));
    } finally {
      setBusy(false);
    }
  };

  const cancelTrip = async () => {
    if (!requestId) return;
    setConfirmCancel(false);
    setBusy(true);
    try {
      await tripService.cancelRequest(requestId);
      toast.info(t('pickup.mismatch.cancelled'));
      router.replace('/requests');
    } catch (cancelError) {
      toast.error(errorMessage(cancelError, t('pickup.mismatch.cancelFailed')));
    } finally {
      setBusy(false);
    }
  };

  const contactDriver = () => {
    const phone = result?.driver?.phone;
    if (phone) void Linking.openURL(`tel:${phone.replace(/[^\d+]/g, '')}`);
    else if (tripId) router.push({ pathname: '/chat/[tripId]', params: { tripId } });
  };

  const header = <ScreenHeader kicker={t('pickup.screen.kicker')} title={t('pickup.screen.title')} />;
  // Without a camera (web, or permission not granted) only the choice screen changes: a sample's
  // progress and result still use the screens below.
  const choosing = phase === 'camera';

  if (Platform.OS === 'web' && choosing) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          {header}
          <Notice tone="info">{t('pickup.screen.webUnavailable')}</Notice>
          {demo ? <SampleClips onPick={(sample) => void trySample(sample)} /> : null}
          <ButtonSecondary onPress={() => router.back()} title={t('common.back')} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!permission?.granted && choosing) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          {header}
          <Text style={styles.subtitle}>{t('pickup.screen.intro')}</Text>
          {permission && !permission.canAskAgain ? (
            <>
              <Notice tone="warning">{t('pickup.screen.cameraBlocked')}</Notice>
              <ButtonPrimary onPress={() => void Linking.openSettings()} title={t('pickup.screen.openSettings')} />
            </>
          ) : (
            <>
              <Notice tone="info">{t('pickup.screen.cameraNeeded')}</Notice>
              <ButtonPrimary icon="camera" onPress={() => void requestPermission()} title={t('pickup.screen.allowCamera')} />
            </>
          )}
          {demo ? <SampleClips onPick={(sample) => void trySample(sample)} /> : null}
          <ButtonSecondary onPress={() => router.back()} title={t('common.back')} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ConfirmDialog
        cancelLabel={t('common.back')}
        confirmLabel={t('pickup.mismatch.cancelConfirm')}
        message={t('pickup.mismatch.cancelMessage')}
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => void cancelTrip()}
        title={t('pickup.mismatch.cancelTitle')}
        tone="danger"
        visible={confirmCancel}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {header}

        {phase === 'camera' || phase === 'recording' ? (
          <>
            <Text style={styles.subtitle}>{t('pickup.screen.intro')}</Text>
            <View style={styles.cameraFrame}>
              <CameraView
                facing="back"
                mode="video"
                mute
                onCameraReady={() => setCameraReady(true)}
                ref={camera}
                style={StyleSheet.absoluteFill}
                videoBitrate={2_500_000}
                videoQuality="720p"
              />
              {phase === 'recording' ? (
                <View accessibilityLiveRegion="polite" style={styles.recordingBadge}>
                  <View style={styles.recordingDot} />
                  <Text style={styles.recordingText}>{t('pickup.screen.recording', { seconds: secondsLeft })}</Text>
                </View>
              ) : null}
            </View>
            {phase === 'recording' ? (
              <ButtonSecondary icon="stop" onPress={() => camera.current?.stopRecording()} title={t('pickup.screen.stop')} />
            ) : (
              <ButtonPrimary disabled={!cameraReady} icon="videocam" onPress={() => void record()} title={t('pickup.screen.record')} />
            )}
            {demo && phase === 'camera' ? <SampleClips onPick={(sample) => void trySample(sample)} /> : null}
          </>
        ) : null}

        {phase === 'processing' ? (
          <View accessibilityLiveRegion="polite" style={styles.processing}>
            {STEPS.map((step, index) => {
              const current = STAGE_STEP[stage];
              const doneStep = index < current;
              return (
                <View key={step} style={styles.stageRow}>
                  {index === current ? (
                    <ActivityIndicator color={colors.primary} size="small" />
                  ) : (
                    <Ionicons color={doneStep ? colors.success : colors.textSecondary} name={doneStep ? 'checkmark-circle' : 'ellipse-outline'} size={20} />
                  )}
                  <Text style={[styles.stageText, index === current && styles.stageCurrent, doneStep && styles.stageDone]}>
                    {t(`pickup.steps.${step}.${doneStep ? 'done' : 'active'}`)}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : null}

        {phase === 'result' && result ? (
          <>
            {result.status === 'verified' ? (
              <View style={[styles.verdict, styles.verdictOk]}>
                <Ionicons color={colors.success} name="checkmark-circle" size={56} />
                <Text style={styles.verdictTitle}>{t('pickup.verified.title')}</Text>
                {result.vehicle ? <Text style={styles.plate}>{result.vehicle.plate}</Text> : null}
                {result.vehicle ? <Text style={styles.verdictText}>{result.vehicle.brand} · {colorName(t, result.vehicle.color)}</Text> : null}
                {result.driver ? <Text style={styles.verdictText}>{t('pickup.verified.text', { driver: result.driver.name })}</Text> : null}
              </View>
            ) : result.status === 'mismatch' ? (
              <View style={[styles.verdict, styles.verdictDanger]}>
                <Ionicons color={colors.error} name="alert-circle" size={56} />
                <Text style={styles.verdictTitle}>{t('pickup.mismatch.title')}</Text>
                <Text style={styles.verdictText}>{t('pickup.mismatch.text')}</Text>
                {mismatchDetail(t, result) ? <Text style={styles.verdictText}>{mismatchDetail(t, result)}</Text> : null}
              </View>
            ) : (
              <Notice title={t(`pickup.retry.${retryKey(result.reason)}.title`)} tone="warning">
                <Text style={styles.resultText}>{t(`pickup.retry.${retryKey(result.reason)}.text`)}</Text>
                {REASONS_WITH_TIPS.has(result.reason) ? FILMING_TIPS.map((tip) => (
                  <View key={tip} style={styles.tip}>
                    <Ionicons color={colors.textSecondary} name="checkmark-circle-outline" size={16} />
                    <Text style={styles.tipText}>{t(`pickup.tips.${tip}`)}</Text>
                  </View>
                )) : null}
              </Notice>
            )}
            {result.mock ? <Text style={styles.mock}>{t('pickup.screen.mock')}</Text> : null}

            {result.status === 'verified' ? (
              <ButtonPrimary icon="checkmark" onPress={() => router.back()} title={t('pickup.verified.done')} />
            ) : result.status === 'mismatch' ? (
              <>
                <ButtonPrimary disabled={busy || demo} icon="close-circle" onPress={() => setConfirmCancel(true)} title={t('pickup.mismatch.cancel')} tone="danger" />
                <ButtonSecondary
                  disabled={busy || (!result.driver?.phone && !tripId)}
                  icon={result.driver?.phone ? 'call' : 'chatbubbles-outline'}
                  onPress={contactDriver}
                  title={result.driver?.phone ? t('pickup.mismatch.call') : t('pickup.mismatch.chat')}
                />
                <ButtonSecondary disabled={busy || demo || reported || !result.verificationId} icon="flag" onPress={() => void report()} title={t('pickup.mismatch.report')} />
                {demo ? <DemoDisabledNote sample={fromSample} /> : null}
                <ButtonSecondary disabled={busy} onPress={() => setPhase('camera')} title={t('pickup.retryAction')} />
              </>
            ) : (
              <>
                <ButtonPrimary icon="videocam" onPress={() => setPhase('camera')} title={t('pickup.retryAction')} />
                <ButtonSecondary onPress={() => router.back()} title={t('common.back')} />
              </>
            )}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  subtitle: { ...typography.body, color: colors.textSecondary },
  cameraFrame: { aspectRatio: 3 / 4, backgroundColor: colors.text, borderRadius: radius.radiusLarge, overflow: 'hidden', width: '100%' },
  recordingBadge: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.radiusMedium,
    flexDirection: 'row',
    gap: spacing[8],
    marginTop: spacing[12],
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[4],
  },
  recordingDot: { backgroundColor: colors.error, borderRadius: 6, height: 12, width: 12 },
  recordingText: { ...typography.bodyMedium, color: colors.text, fontWeight: '600' },
  processing: { alignItems: 'flex-start', backgroundColor: colors.primaryLight, borderRadius: radius.radiusLarge, gap: spacing[12], padding: spacing[20] },
  stageRow: { alignItems: 'center', flexDirection: 'row', gap: spacing[8] },
  stageText: { ...typography.bodyMedium, color: colors.textSecondary },
  stageCurrent: { color: colors.text, fontWeight: '600' },
  stageDone: { color: colors.text },
  verdict: { alignItems: 'center', borderRadius: radius.radiusLarge, borderWidth: 2, gap: spacing[8], padding: spacing[20] },
  verdictOk: { backgroundColor: colors.surface, borderColor: colors.success },
  verdictDanger: { backgroundColor: colors.surface, borderColor: colors.error },
  verdictTitle: { ...typography.headingL, color: colors.text, textAlign: 'center' },
  verdictText: { ...typography.body, color: colors.text, textAlign: 'center' },
  plate: { ...typography.headingXL, color: colors.text, letterSpacing: 2 },
  resultText: { ...typography.bodySmall, color: colors.text },
  tip: { alignItems: 'center', alignSelf: 'stretch', flexDirection: 'row', gap: spacing[8], marginTop: spacing[4] },
  tipText: { ...typography.bodySmall, color: colors.textSecondary, flex: 1 },
  mock: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
});
