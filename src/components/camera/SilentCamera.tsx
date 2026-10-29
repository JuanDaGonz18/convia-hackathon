import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CameraView } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';

/** Same shape as ImagePicker's result, so screens only swap the call. */
export type SilentPhotoResult = { canceled: true; assets: null } | { canceled: false; assets: { uri: string; width: number; height: number }[] };

/**
 * Photos taken inside the app with the shutter sound off (expo-camera `shutterSound: false`).
 * The system camera app (ImagePicker.launchCameraAsync) always plays its own sound, which the
 * app can't turn off. On the web the browser's camera/file picker is used as before.
 *
 *   const { takePhoto, cameraModal } = useSilentCamera();
 *   const picked = await takePhoto();   // render {cameraModal} in the screen
 */
export function useSilentCamera({ quality = 0.8 }: { quality?: number } = {}) {
  const [open, setOpen] = useState(false);
  const resolver = useRef<((result: SilentPhotoResult) => void) | null>(null);

  const finish = useCallback((result: SilentPhotoResult) => {
    setOpen(false);
    resolver.current?.(result);
    resolver.current = null;
  }, []);

  const takePhoto = useCallback(async (): Promise<SilentPhotoResult> => {
    if (Platform.OS === 'web') {
      const picked = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality });
      return picked.canceled ? { canceled: true, assets: null } : { canceled: false, assets: picked.assets.map(({ uri, width, height }) => ({ uri, width, height })) };
    }
    return new Promise<SilentPhotoResult>((resolve) => {
      resolver.current = resolve;
      setOpen(true);
    });
  }, [quality]);

  const cameraModal = open ? <SilentCameraModal onDone={finish} quality={quality} /> : null;
  return { takePhoto, cameraModal };
}

function SilentCameraModal({ onDone, quality }: Readonly<{ onDone: (result: SilentPhotoResult) => void; quality: number }>) {
  const { t } = useTranslation();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  const shoot = async () => {
    if (!camera.current || busy) return;
    setBusy(true);
    try {
      const photo = await camera.current.takePictureAsync({ quality, exif: false, shutterSound: false });
      onDone(photo?.uri ? { canceled: false, assets: [{ uri: photo.uri, width: photo.width, height: photo.height }] } : { canceled: true, assets: null });
    } catch {
      onDone({ canceled: true, assets: null });
    }
  };

  return (
    <Modal animationType="slide" onRequestClose={() => onDone({ canceled: true, assets: null })} statusBarTranslucent visible>
      <View style={styles.root}>
        <CameraView animateShutter facing="back" mode="picture" onCameraReady={() => setReady(true)} ref={camera} style={StyleSheet.absoluteFill} />
        <SafeAreaView edges={['top', 'bottom']} style={styles.overlay}>
          <Pressable accessibilityLabel={t('camera.close')} accessibilityRole="button" hitSlop={12} onPress={() => onDone({ canceled: true, assets: null })} style={styles.close}>
            <Ionicons color={colors.white} name="close" size={28} />
          </Pressable>
          <View style={styles.bottom}>
            <Pressable
              accessibilityLabel={t('camera.take')}
              accessibilityRole="button"
              disabled={!ready || busy}
              onPress={() => void shoot()}
              style={[styles.shutter, (!ready || busy) && styles.shutterDisabled]}
            >
              {busy ? <ActivityIndicator color={colors.primary} /> : <View style={styles.shutterInner} />}
            </Pressable>
            <Text style={styles.hint}>{t('camera.take')}</Text>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#000', flex: 1 },
  overlay: { flex: 1, justifyContent: 'space-between' },
  close: { alignSelf: 'flex-start', margin: spacing[16], padding: spacing[4] },
  bottom: { alignItems: 'center', gap: spacing[8], paddingBottom: spacing[24] },
  shutter: { alignItems: 'center', backgroundColor: colors.white, borderRadius: 40, height: 80, justifyContent: 'center', width: 80 },
  shutterDisabled: { opacity: 0.5 },
  shutterInner: { borderColor: colors.primary, borderRadius: 32, borderWidth: 3, height: 64, width: 64 },
  hint: { ...typography.bodySmall, color: colors.white },
});
