/**
 * Reason codes of the pickup check ("Verificar mi carro") that the app adds to
 * the server's. Their texts live in src/i18n/locales under pickup.retry.<reason>;
 * every reason the server or the app can return must have one (see the test).
 */

export const PICKUP_CLIENT_REASONS = [
  'offline',
  'auth_required',
  'recording_failed',
  'frames_failed',
  'upload_failed',
  'network_error',
  'not_found',
  'not_accepted',
  'unsupported_vehicle',
] as const;

export type PickupClientReason = (typeof PICKUP_CLIENT_REASONS)[number];

/** Retry reasons where filming better helps: they come with the filming tips (pickup.tips.*). */
export const REASONS_WITH_TIPS: ReadonlySet<string> = new Set([
  'no_car', 'no_plate', 'poor_quality', 'plate_unreadable', 'low_confidence', 'plate_uncertain', 'vehicle_uncertain',
]);

export const FILMING_TIPS = ['front', 'near', 'still'] as const;

/** Colors Muse Spark reports (one Spanish word); the app shows them in the user's language (colors.<word>). */
export const KNOWN_COLORS = ['blanco', 'negro', 'gris', 'plata', 'rojo', 'azul', 'verde', 'amarillo', 'naranja', 'cafe', 'beige', 'dorado'] as const;
