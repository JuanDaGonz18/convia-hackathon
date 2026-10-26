import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

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
import { PICKUP_TEXTS, retryText } from '@/content/pickupVerification';
import { PICKUP_CLIP_SECONDS, type PickupStage, type PickupVerification, pickupVerificationService } from '@/services/pickupVerificationService';
import { tripService } from '@/services/tripService';
import { errorMessage } from '@/utils/format';

const T = PICKUP_TEXTS;
type Phase = 'camera' | 'recording' | 'processing' | 'result';

/** What differs between the car filmed and the trip's car, in one sentence. */
function mismatchDetail({ reason, plateRead, brandRead, colorRead, vehicle }: PickupVerification) {
  if (!vehicle) return null;
  if (reason === 'plate_mismatch' && plateRead) return T.mismatch.plate_mismatch(plateRead, vehicle.plate);
  if (reason === 'brand_mismatch' && brandRead) return T.mismatch.brand_mismatch(brandRead, vehicle.brand);
  if (reason === 'color_mismatch' && colorRead) return T.mismatch.color_mismatch(colorRead, vehicle.color.toLowerCase());
  return null;
}

/**
 * "Verificar mi carro" (`?requestId=&tripId=`): the passenger films the arriving
 * car for up to 5 s and verify-pickup says whether it is the trip's car.
 * Nothing is kept: the clip and its frames are deleted after the check.
 */
export default function PickupVerifyScreen() {
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

  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = setInterval(() => setSecondsLeft((left) => Math.max(0, left - 1)), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const record = async () => {
    if (!camera.current || !requestId) return;
    setResult(null);
    setReported(false);
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

  const report = async () => {
    if (!result?.verificationId) return;
    setBusy(true);
    try {
      await pickupVerificationService.reportMismatch(result.verificationId);
      setReported(true);
      toast.info(T.mismatch.reported);
    } catch (reportError) {
      toast.error(errorMessage(reportError, T.mismatch.reportFailed));
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
      toast.info(T.mismatch.cancelled);
      router.replace('/requests');
    } catch (cancelError) {
      toast.error(errorMessage(cancelError, T.mismatch.cancelFailed));
    } finally {
      setBusy(false);
    }
  };

  const contactDriver = () => {
    const phone = result?.driver?.phone;
    if (phone) void Linking.openURL(`tel:${phone.replace(/[^\d+]/g, '')}`);
    else if (tripId) router.push({ pathname: '/chat/[tripId]', params: { tripId } });
  };

  const header = <ScreenHeader kicker={T.screen.kicker} title={T.screen.title} />;

  if (Platform.OS === 'web') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          {header}
          <Notice tone="info">{T.screen.webUnavailable}</Notice>
          <ButtonSecondary onPress={() => router.back()} title={T.screen.back} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!permission?.granted) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          {header}
          <Text style={styles.subtitle}>{T.screen.intro}</Text>
          {permission && !permission.canAskAgain ? (
            <>
              <Notice tone="warning">{T.screen.cameraBlocked}</Notice>
              <ButtonPrimary onPress={() => void Linking.openSettings()} title={T.screen.openSettings} />
            </>
          ) : (
            <>
              <Notice tone="info">{T.screen.cameraNeeded}</Notice>
              <ButtonPrimary icon="camera" onPress={() => void requestPermission()} title={T.screen.allowCamera} />
            </>
          )}
          <ButtonSecondary onPress={() => router.back()} title={T.screen.back} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ConfirmDialog
        cancelLabel={T.mismatch.cancelBack}
        confirmLabel={T.mismatch.cancelConfirm}
        message={T.mismatch.cancelMessage}
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => void cancelTrip()}
        title={T.mismatch.cancelTitle}
        tone="danger"
        visible={confirmCancel}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {header}

        {phase === 'camera' || phase === 'recording' ? (
          <>
            <Text style={styles.subtitle}>{T.screen.intro}</Text>
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
                  <Text style={styles.recordingText}>{T.screen.recording(secondsLeft)}</Text>
                </View>
              ) : null}
            </View>
            {phase === 'recording' ? (
              <ButtonSecondary icon="stop" onPress={() => camera.current?.stopRecording()} title={T.screen.stop} />
            ) : (
              <ButtonPrimary disabled={!cameraReady} icon="videocam" onPress={() => void record()} title={T.screen.record} />
            )}
          </>
        ) : null}

        {phase === 'processing' ? (
          <View accessibilityLiveRegion="polite" style={styles.processing}>
            <ActivityIndicator color={colors.primary} size="large" />
            {(['uploading', 'analyzing', 'verifying'] as const).map((step, index) => {
              const current = ['uploading', 'analyzing', 'verifying'].indexOf(stage);
              const doneStep = index < current;
              return (
                <View key={step} style={styles.stageRow}>
                  <Ionicons
                    color={doneStep ? colors.success : index === current ? colors.primary : colors.textSecondary}
                    name={doneStep ? 'checkmark-circle' : index === current ? 'ellipse' : 'ellipse-outline'}
                    size={18}
                  />
                  <Text style={[styles.stageText, index === current && styles.stageCurrent]}>{T.stages[step]}</Text>
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
                <Text style={styles.verdictTitle}>{T.verified.title}</Text>
                {result.vehicle ? <Text style={styles.plate}>{result.vehicle.plate}</Text> : null}
                {result.vehicle ? <Text style={styles.verdictText}>{result.vehicle.brand} · {result.vehicle.color}</Text> : null}
                {result.driver ? <Text style={styles.verdictText}>{T.verified.text(result.driver.name)}</Text> : null}
              </View>
            ) : result.status === 'mismatch' ? (
              <View style={[styles.verdict, styles.verdictDanger]}>
                <Ionicons color={colors.error} name="alert-circle" size={56} />
                <Text style={styles.verdictTitle}>{T.mismatch.title}</Text>
                <Text style={styles.verdictText}>{T.mismatch.text}</Text>
                {mismatchDetail(result) ? <Text style={styles.verdictText}>{mismatchDetail(result)}</Text> : null}
              </View>
            ) : (
              <Notice title={retryText(result.reason).title} tone="warning">
                <Text style={styles.resultText}>{retryText(result.reason).text}</Text>
                {retryText(result.reason).tips?.map((tip) => (
                  <View key={tip} style={styles.tip}>
                    <Ionicons color={colors.textSecondary} name="checkmark-circle-outline" size={16} />
                    <Text style={styles.tipText}>{tip}</Text>
                  </View>
                ))}
              </Notice>
            )}
            {result.mock ? <Text style={styles.mock}>{T.screen.mock}</Text> : null}

            {result.status === 'verified' ? (
              <ButtonPrimary icon="checkmark" onPress={() => router.back()} title={T.verified.done} />
            ) : result.status === 'mismatch' ? (
              <>
                <ButtonPrimary disabled={busy} icon="close-circle" onPress={() => setConfirmCancel(true)} title={T.mismatch.cancel} tone="danger" />
                <ButtonSecondary
                  disabled={busy || (!result.driver?.phone && !tripId)}
                  icon={result.driver?.phone ? 'call' : 'chatbubbles-outline'}
                  onPress={contactDriver}
                  title={result.driver?.phone ? T.mismatch.call : T.mismatch.chat}
                />
                <ButtonSecondary disabled={busy || reported || !result.verificationId} icon="flag" onPress={() => void report()} title={T.mismatch.report} />
                <ButtonSecondary disabled={busy} onPress={() => setPhase('camera')} title={T.mismatch.retry} />
              </>
            ) : (
              <>
                <ButtonPrimary icon="videocam" onPress={() => setPhase('camera')} title={T.retryAction} />
                <ButtonSecondary onPress={() => router.back()} title={T.screen.back} />
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
