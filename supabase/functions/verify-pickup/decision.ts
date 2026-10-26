/**
 * Pickup verdict, decided by code. The plate, brand and color comparison is
 * verify-vehicle's `decide()` (pre-existing); this file maps it to what the
 * passenger needs and adds one rule of its own. Every outcome carries a
 * stable reason code: the app translates it, the server sends no text.
 * No Deno APIs, so it can be unit-tested with Node.
 */
import { decide, type VisionReport } from '../verify-vehicle/decision.ts';

export type PickupStatus = 'verified' | 'mismatch' | 'retry';

/** Every reason the function can return. The app must have a text for each one. */
export const PICKUP_REASONS = {
  verified: ['plate_match'],
  mismatch: ['plate_mismatch', 'vehicle_mismatch'],
  retry: [
    // The clip
    'clip_unreadable', 'clip_too_long', 'frame_missing',
    // What SAM saw
    'no_car', 'no_plate',
    // What Muse Spark read (from decide())
    'not_live_photo', 'poor_quality', 'plate_unreadable', 'low_confidence', 'plate_uncertain',
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

export function pickupRetry(reason: (typeof PICKUP_REASONS)['retry'][number]): PickupDecision {
  return { status: 'retry', reason, plateRead: null, confidence: null, brandMatch: null, colorMatch: null };
}

/**
 * verified: the plate matches and neither brand nor color clearly differs.
 * For a driver registering a car, the right plate with one odd attribute is
 * still that car. For a passenger about to get in, the right plate on a car
 * of another brand or color is a warning sign (a copied plate), so it is a
 * mismatch.
 */
export function decidePickup(
  report: VisionReport,
  registered: { plate: string; brand: string; color: string },
): PickupDecision {
  const result = decide(report, registered);
  const extra = { plateRead: result.plateRead, confidence: result.confidence, brandMatch: result.brandMatch, colorMatch: result.colorMatch };
  if (result.status === 'retry') {
    const reason = (PICKUP_REASONS.retry as readonly string[]).includes(result.reason) ? result.reason : 'bad_model_response';
    return { status: 'retry', reason: reason as PickupReason, ...extra };
  }
  if (result.status === 'failed') {
    return { status: 'mismatch', reason: result.reason === 'vehicle_mismatch' ? 'vehicle_mismatch' : 'plate_mismatch', ...extra };
  }
  if (result.brandMatch === false || result.colorMatch === false) {
    return { status: 'mismatch', reason: 'vehicle_mismatch', ...extra };
  }
  return { status: 'verified', reason: 'plate_match', ...extra };
}
