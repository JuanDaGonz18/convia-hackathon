/**
 * The exact proposal the user confirms. Its SHA-256 over canonical JSON binds the Confirm tap to
 * what was verified: /confirm recomputes it from the database and refuses if anything changed.
 * Uses Web Crypto (Deno and Node). Pure, unit-tested.
 */

export type ProposalPlace = { label: string; lat: number; lng: number };

export type ProposalFields = {
  trip_id: string;
  seats: number;
  price: number;
  /** ISO 8601, UTC, as stored (salida_at). */
  departure: string;
  pickup: ProposalPlace | null;
  dropoff: ProposalPlace;
};

/** Stable JSON: keys sorted at every level, coordinates rounded to 6 decimals, departure normalized. */
export function canonical(fields: ProposalFields) {
  const place = (p: ProposalPlace | null) => (p ? { label: p.label, lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 } : null);
  const value = {
    departure: new Date(fields.departure).toISOString(),
    dropoff: place(fields.dropoff),
    pickup: place(fields.pickup),
    price: Number(fields.price),
    seats: fields.seats,
    trip_id: fields.trip_id,
  };
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === 'object') return Object.fromEntries(Object.keys(input).sort().map((key) => [key, sort((input as Record<string, unknown>)[key])]));
    return input;
  };
  return JSON.stringify(sort(value));
}

export async function proposalHash(fields: ProposalFields) {
  const bytes = new TextEncoder().encode(canonical(fields));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
