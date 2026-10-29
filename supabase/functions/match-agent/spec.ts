/**
 * Checkpoint 1 — the request spec. The agent's first structured output must be the parsed request;
 * code verifies it before any search, and answers with specific feedback when it is wrong. Places
 * must be references to candidates resolve_place returned IN THIS RUN ("place:2"), never free text
 * or coordinates the model made up. The accepted spec is frozen: searches must match it.
 * Pure TypeScript, unit-tested.
 */
import { AREA } from './places.ts';
import { bogotaInstant } from './search.ts';

/** A place candidate resolve_place returned in this run, with the reference the model uses. */
export type PlaceRef = { ref: string; label: string; lat: number; lng: number; query: string; ambiguous: boolean };

export type AcceptedSpec = {
  origin: PlaceRef | null;
  destination: PlaceRef;
  date: string;
  time: string;
  flexMinutes: number;
  seats: number;
  maxPrice: number | null;
  language: 'es' | 'en';
};

export type SpecCheck = { ok: true; spec: AcceptedSpec } | { ok: false; errors: string[] };

/** Requests further ahead than this aren't searched (the app's matcher looks a week ahead). */
export const MAX_DAYS_AHEAD = 7;
/** Origin and destination closer than this are the same place. */
const SAME_PLACE_KM = 1;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (v: number) => (v * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const inArea = ({ lat, lng }: { lat: number; lng: number }) => lat >= AREA.minLat && lat <= AREA.maxLat && lng >= AREA.minLng && lng <= AREA.maxLng;

function readPlace(value: unknown, name: string, places: Map<string, PlaceRef>, errors: string[]): PlaceRef | null {
  if (typeof value !== 'string' || !/^place:\d+$/.test(value)) {
    errors.push(`${name} must be a reference like "place:1" from a resolve_place result in this run`);
    return null;
  }
  const place = places.get(value);
  if (!place) {
    errors.push(`${name}: ${value} was not returned by resolve_place in this run; call resolve_place first`);
    return null;
  }
  if (place.ambiguous) {
    errors.push(`${name}: "${place.query}" matched several places; ask the user which one (ask_clarification)`);
    return null;
  }
  if (!inArea(place)) errors.push(`${name}: ${place.label} is outside the area ConVía serves`);
  return place;
}

export function checkSpec(raw: unknown, places: Map<string, PlaceRef>, now: Date): SpecCheck {
  if (!isObject(raw)) return { ok: false, errors: ['the spec must be an object'] };
  const errors: string[] = [];
  const allowed = ['origin', 'destination', 'date', 'time', 'flex_minutes', 'seats', 'max_price_cop', 'language'];
  const extra = Object.keys(raw).filter((key) => !allowed.includes(key));
  if (extra.length) errors.push(`unknown fields: ${extra.join(', ')}`);

  const destination = raw.destination === undefined || raw.destination === null
    ? (errors.push('destination is required; ask the user where they are going'), null)
    : readPlace(raw.destination, 'destination', places, errors);
  const origin = raw.origin === undefined || raw.origin === null ? null : readPlace(raw.origin, 'origin', places, errors);
  if (origin && destination && km(origin, destination) < SAME_PLACE_KM) errors.push('origin and destination are the same place');

  const date = typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : null;
  const time = typeof raw.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time) ? raw.time : null;
  if (!date) errors.push('date must be YYYY-MM-DD (Colombia); if the user gave no day, ask');
  if (!time) errors.push('time must be HH:MM, 24 h (Colombia); if the user gave no time, ask');

  const flexMinutes = raw.flex_minutes === undefined || raw.flex_minutes === null ? 60 : raw.flex_minutes;
  if (typeof flexMinutes !== 'number' || !Number.isInteger(flexMinutes) || flexMinutes < 15 || flexMinutes > 180) errors.push('flex_minutes must be an integer from 15 to 180');
  const seats = raw.seats === undefined || raw.seats === null ? 1 : raw.seats;
  if (typeof seats !== 'number' || !Number.isInteger(seats) || seats < 1 || seats > 4) errors.push('seats must be an integer from 1 to 4');
  const maxPrice = raw.max_price_cop === undefined || raw.max_price_cop === null ? null : raw.max_price_cop;
  if (maxPrice !== null && (typeof maxPrice !== 'number' || !Number.isInteger(maxPrice) || maxPrice < 0)) errors.push('max_price_cop must be a non-negative integer or null');
  const language = raw.language === 'en' ? 'en' : 'es';

  if (date && time && typeof flexMinutes === 'number') {
    const at = bogotaInstant(date, time);
    if (Number.isNaN(at.getTime())) errors.push(`${date} ${time} is not a valid date and time`);
    else {
      const windowEnd = at.getTime() + flexMinutes * 60000;
      if (windowEnd <= now.getTime()) errors.push(`${date} ${time} (±${flexMinutes} min) is already in the past in Colombia; check the day`);
      if (at.getTime() - now.getTime() > MAX_DAYS_AHEAD * 86_400_000) errors.push(`${date} is more than ${MAX_DAYS_AHEAD} days ahead; trips are offered up to a week before`);
    }
  }

  if (errors.length || !destination || !date || !time) return { ok: false, errors };
  return {
    ok: true,
    spec: { origin, destination, date, time, flexMinutes: flexMinutes as number, seats: seats as number, maxPrice: maxPrice as number | null, language },
  };
}

/** search_trips must use the frozen spec: same places, date, time, window, seats and budget. */
export function checkSearchMatchesSpec(args: { origin: { lat: number; lng: number } | null; destination: { lat: number; lng: number }; date: string; time: string; flexMinutes: number; seats: number; maxPrice: number | null }, spec: AcceptedSpec) {
  const errors: string[] = [];
  const near = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => km(a, b) < 0.05;
  if (!near(args.destination, spec.destination)) errors.push(`destination must be the accepted ${spec.destination.ref} (${spec.destination.label})`);
  if (spec.origin ? !args.origin || !near(args.origin, spec.origin) : args.origin !== null) {
    errors.push(spec.origin ? `origin must be the accepted ${spec.origin.ref} (${spec.origin.label})` : 'the accepted spec has no origin; omit it');
  }
  if (args.date !== spec.date || args.time !== spec.time) errors.push(`date and time must be the accepted ${spec.date} ${spec.time}`);
  if (args.flexMinutes !== spec.flexMinutes) errors.push(`flex_minutes must be the accepted ${spec.flexMinutes}`);
  if (args.seats !== spec.seats) errors.push(`seats must be the accepted ${spec.seats}`);
  if (args.maxPrice !== spec.maxPrice) errors.push(`max_price_cop must be the accepted ${spec.maxPrice ?? 'null'}`);
  return errors;
}
