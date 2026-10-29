/**
 * Pickup verdict, decided by code. Reading and comparing the plate, brand and
 * color is verify-vehicle's `decide()` (pre-existing); this file maps it to
 * what the passenger needs. Telling a passenger "don't get in" accuses a
 * driver, so a mismatch needs a confident reading: any doubt is a retry.
 * Every outcome carries a stable reason code: the app translates it.
 * No Deno APIs, so it can be unit-tested with Node.
 */
import { colorMatches, decide, type VisionReport } from '../verify-vehicle/decision.ts';

export type PickupStatus = 'verified' | 'mismatch' | 'retry';

/** Muse Spark's answer for a pickup: verify-vehicle's report plus how sure it is of brand and color. */
export type PickupReport = VisionReport & { brand_confidence: number; color_confidence: number };

/** Every reason the function can return. The app must have a text for each one. */
export const PICKUP_REASONS = {
  verified: ['plate_match'],
  mismatch: ['plate_mismatch', 'brand_mismatch', 'color_mismatch'],
  retry: [
    // The clip
    'clip_unreadable', 'clip_too_long', 'frame_missing',
    // What SAM saw
    'no_car', 'no_plate',
    // What Muse Spark read
    'not_live_photo', 'poor_quality', 'plate_unreadable', 'low_confidence', 'plate_uncertain', 'vehicle_uncertain',
    // The models or the server
    'timeout', 'rate_limited', 'service_unavailable', 'bad_model_response', 'too_many_attempts', 'server_error',
  ],
} as const satisfies Record<PickupStatus, readonly string[]>;

export type PickupReason = (typeof PICKUP_REASONS)[PickupStatus][number];

export type PickupDecision = {
  status: PickupStatus;
  reason: PickupReason;
  plateRead: string | null;
  confidence: number | null;
  brandMatch: boolean | null;
  colorMatch: boolean | null;
};

/** A different plate, brand or color counts as a mismatch only at or above this confidence. */
export const MISMATCH_CONFIDENCE = 0.85;

/**
 * Color families that light, shade and reflections turn into each other
 * (one word of each family that decision.ts knows). A registered gris read
 * as azul is not evidence of another car.
 */
const NEIGHBOR_COLORS: readonly (readonly [string, string])[] = [
  ['gris', 'blanco'], ['gris', 'negro'], ['gris', 'azul'], ['negro', 'azul'], ['azul', 'verde'],
  ['rojo', 'naranja'], ['rojo', 'cafe'], ['amarillo', 'naranja'], ['cafe', 'blanco'], ['cafe', 'negro'],
];

export function neighborColors(registered: string, read: string) {
  return NEIGHBOR_COLORS.some(([a, b]) =>
    (colorMatches(registered, a) === true && colorMatches(read, b) === true)
    || (colorMatches(registered, b) === true && colorMatches(read, a) === true));
}

export function pickupRetry(reason: (typeof PICKUP_REASONS)['retry'][number]): PickupDecision {
  return { status: 'retry', reason, plateRead: null, confidence: null, brandMatch: null, colorMatch: null };
}

const sure = (value: unknown) => typeof value === 'number' && value >= MISMATCH_CONFIDENCE;

/**
 * verified: the plate matches and brand and color agree (or are unknown, or
 * the color is a neighbor). mismatch: a confident different plate, or the
 * right plate on a car of a confidently different brand or color (a copied
 * plate). Everything in between is a retry.
 */
export function decidePickup(
  report: PickupReport,
  registered: { plate: string; brand: string; color: string },
): PickupDecision {
  const result = decide(report, registered);
  const extra = { plateRead: result.plateRead, confidence: result.confidence, brandMatch: result.brandMatch, colorMatch: result.colorMatch };
  if (result.status === 'retry') {
    const reason = (PICKUP_REASONS.retry as readonly string[]).includes(result.reason) ? result.reason : 'bad_model_response';
    return { status: 'retry', reason: reason as PickupReason, ...extra };
  }
  // decide() says 'plate_mismatch' only for another plate; 'plate_match' and 'vehicle_mismatch' mean the plate matched.
  if (result.reason === 'plate_mismatch') {
    return sure(result.confidence) ? { status: 'mismatch', reason: 'plate_mismatch', ...extra } : { status: 'retry', reason: 'plate_uncertain', ...extra };
  }
  const brandDiffers = result.brandMatch === false;
  const colorDiffers = result.colorMatch === false && !neighborColors(registered.color, report.color);
  if (brandDiffers && sure(report.brand_confidence)) return { status: 'mismatch', reason: 'brand_mismatch', ...extra };
  if (colorDiffers && sure(report.color_confidence)) return { status: 'mismatch', reason: 'color_mismatch', ...extra };
  if (brandDiffers || colorDiffers) return { status: 'retry', reason: 'vehicle_uncertain', ...extra };
  return { status: 'verified', reason: 'plate_match', ...extra };
}
