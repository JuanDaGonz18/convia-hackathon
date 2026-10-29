import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { type TripRequestRecord, tripService } from '@/services/tripService';
import { formatDateTime } from '@/utils/format';

/** From this long before departure the boarding QR is the main action. */
const NEAR_MS = 2 * 60 * 60 * 1000;
/** Trips that left longer ago than this are no longer "next". */
const AFTER_DEPARTURE_MS = 60 * 60 * 1000;

/** The passenger's next accepted (or boarded) trip, soonest first. */
export function pickNextRide(requests: TripRequestRecord[], now = Date.now(), tripId?: string) {
  return requests
    .filter((request) => (request.estado === 'aceptado' || request.estado === 'abordado') && request.tripDepartureAt)
    .filter((request) => !tripId || request.trip_id === tripId)
    .filter((request) => new Date(request.tripDepartureAt!).getTime() > now - AFTER_DEPARTURE_MS)
    .sort((a, b) => new Date(a.tripDepartureAt!).getTime() - new Date(b.tripDepartureAt!).getTime())[0] ?? null;
}

/**
 * Home (passenger) and trip summary: the next ride with its boarding QR. Close to
 * departure "Show my boarding QR" becomes the big primary button. Renders nothing
 * when there is no accepted trip.
 */
export function NextRideCard({ tripId }: Readonly<{ tripId?: string }>) {
  const { t } = useTranslation();
  // "Near" is decided when the trips load (focus), not during render.
  const [next, setNext] = useState<{ ride: TripRequestRecord; near: boolean } | null>(null);

  useFocusEffect(useCallback(() => {
    let active = true;
    tripService.getPassengerRequests()
      .then((requests) => {
        if (!active) return;
        const now = Date.now();
        const ride = pickNextRide(requests, now, tripId);
        setNext(ride ? { ride, near: new Date(ride.tripDepartureAt!).getTime() - now <= NEAR_MS } : null);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [tripId]));

  if (!next) return null;
  const { ride, near } = next;
  const showQr = () => router.push({ pathname: '/boarding-qr', params: { requestId: ride.id } });

  return (
    <View style={[styles.card, near && styles.cardNear]}>
      <View style={styles.header}>
        <Ionicons color={colors.primary} name="car-outline" size={18} />
        <Text style={styles.kicker}>{near ? t('nextRide.soon') : t('nextRide.title')}</Text>
      </View>
      {ride.tripLabel ? <Text style={styles.route}>{ride.tripLabel}</Text> : null}
      <Text style={styles.meta}>{formatDateTime(ride.tripDepartureAt!)} · {ride.direccion}</Text>
      {near
        ? <ButtonPrimary icon="qr-code-outline" onPress={showQr} title={t('nextRide.showQr')} />
        : <ButtonSecondary icon="qr-code-outline" onPress={showQr} title={t('nextRide.showQr')} />}
      {ride.estado === 'aceptado' ? (
        <ButtonSecondary
          icon="videocam-outline"
          onPress={() => router.push({ pathname: '/pickup-verify', params: { requestId: ride.id, tripId: ride.trip_id } })}
          title={t('nextRide.verifyCar')}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderColor: colors.border, borderRadius: radius.radiusLarge, borderWidth: 1, gap: spacing[8], padding: spacing[16] },
  cardNear: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing[8] },
  kicker: { ...typography.caption, color: colors.primary, fontWeight: '700', textTransform: 'uppercase' },
  route: { ...typography.bodyMedium, color: colors.text, fontWeight: '700' },
  meta: { ...typography.bodySmall, color: colors.textSecondary },
});
