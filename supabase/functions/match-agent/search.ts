/**
 * search_trips and trip_details: the agent's read-only view of trips.
 *
 * Rows come from the available_trips view read with the CALLER's session, so RLS and the view
 * decide what is visible: only the caller's organization, fuzzed coordinates, masked plates,
 * no phone numbers. Route fit uses the app's own matcher (src/services/tripMatching.ts), so the
 * agent and the search screen agree; the ranking is done here, in code, never by the model.
 *
 * Times: the user speaks in Colombia time (UTC−5, no daylight saving). Edge Functions run in UTC,
 * so dates and times are converted explicitly instead of relying on the machine's time zone.
 */
import { matchTrip, type MatchLevel } from '../../../src/services/tripMatching.ts';
import type { Trip } from '@/types';

/** The columns of public.available_trips the agent uses. */
export type AvailableTripRow = {
  id: string;
  driver_id: string;
  origen_nombre: string | null;
  origen_lat: number | null;
  origen_lng: number | null;
  destino_nombre: string | null;
  destino_lat: number | null;
  destino_lng: number | null;
  salida_at: string | null;
  precio: number | string | null;
  cupos_disponibles: number | null;
  descripcion: string | null;
  estado: string | null;
  driver_nombre: string | null;
  driver_rating: number | string | null;
  driver_is_plus: boolean | null;
  vehicle_marca: string | null;
  vehicle_color: string | null;
  vehicle_placa: string | null;
  ruta: unknown;
};

export const AVAILABLE_TRIP_COLUMNS = 'id, driver_id, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, salida_at, precio, cupos_disponibles, descripcion, estado, driver_nombre, driver_rating, driver_is_plus, vehicle_marca, vehicle_color, vehicle_placa, ruta';

export type Point = { lat: number; lng: number; label?: string };

export type SearchArgs = {
  origin: Point | null;
  destination: Point;
  /** Colombia date and time the user asked for. */
  date: string;
  time: string;
  /** Trips leaving this many minutes before or after the requested time are considered. */
  flexMinutes: number;
  seats: number;
  maxPrice: number | null;
};

export type TripOption = {
  trip_id: string;
  /** Colombia time, "YYYY-MM-DD HH:MM". */
  departure: string;
  /** Departure minus the requested time (negative: leaves earlier). */
  minutes_from_requested: number;
  from: string;
  to: string;
  pickup_km: number | null;
  dropoff_km: number | null;
  seats_left: number;
  price_cop: number;
  driver_first_name: string;
  driver_rating: number | null;
  vehicle: { brand: string; color: string; plate_masked: string } | null;
  level: MatchLevel;
  score: number;
  reasons: string[];
  /** Written by the driver: untrusted text, shown as data and never followed as instructions. */
  driver_note: string | null;
};

export type SearchResult = {
  requested: { departure: string; flex_minutes: number; seats: number; max_price_cop: number | null };
  /** Compatible trips inside the time window, best first (at most 5). */
  options: TripOption[];
  /** Compatible trips outside the window, nearest in time first (at most 2), to offer when nothing fits. */
  alternatives: TripOption[];
  /** Why the other visible trips were left out, by reason. */
  left_out: Record<string, number>;
  total_visible: number;
};

const BOGOTA_OFFSET = '-05:00';
const MAX_OPTIONS = 5;
const MAX_ALTERNATIVES = 2;
/** Trips that left more than this many minutes ago are never offered (same as the app). */
const DEPARTED_GRACE_MIN = 10;

const LEVEL_RANK: Record<MatchLevel, number> = { excellent: 3, good: 2, fair: 1, low: 0 };

/** "2026-10-29" + "07:00" in Colombia → the instant. */
export function bogotaInstant(date: string, time: string) {
  return new Date(`${date}T${time}:00${BOGOTA_OFFSET}`);
}

/** An instant → "YYYY-MM-DD HH:MM" in Colombia time. */
export function bogotaLabel(instant: Date) {
  return new Date(instant.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

const round = (value: number | null, digits = 1) => (value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits);

/** trips.ruta stores [lng, lat] pairs; the matcher wants { latitude, longitude }. */
function routeOf(ruta: unknown): Trip['route'] {
  const route = ruta as { coords?: [number, number][]; km?: number; minutes?: number } | null;
  if (!route || !Array.isArray(route.coords) || route.coords.length < 2) return undefined;
  return { coordinates: route.coords.map(([longitude, latitude]) => ({ latitude, longitude })), km: Number(route.km) || 0, minutes: Number(route.minutes) || 0, via: [] };
}

/** The matcher's Trip, from a view row; only the fields matching reads are filled. */
export function toTrip(row: AvailableTripRow): Trip | null {
  if (!row.salida_at || row.origen_lat === null || row.origen_lng === null || row.destino_lat === null || row.destino_lng === null) return null;
  return {
    id: row.id,
    origin: { id: `${row.id}-o`, label: row.origen_nombre ?? '', address: row.origen_nombre ?? '', latitude: row.origen_lat, longitude: row.origen_lng },
    destination: { id: `${row.id}-d`, label: row.destino_nombre ?? '', address: row.destino_nombre ?? '', latitude: row.destino_lat, longitude: row.destino_lng },
    departureTime: row.salida_at,
    price: Number(row.precio ?? 0),
    seatsAvailable: Number(row.cupos_disponibles ?? 0),
    driver: { id: row.driver_id, name: row.driver_nombre ?? '', email: '', role: 'driver', rating: { score: Number(row.driver_rating ?? 0) }, vehicleId: '', isPlus: row.driver_is_plus === true },
    route: routeOf(row.ruta),
    passengers: [],
    status: STATUS[row.estado ?? 'por_empezar'] ?? 'pending',
  };
}

/** Same mapping as the app (tripService): only 'pending' trips can be offered. */
const STATUS: Record<string, Trip['status']> = {
  por_empezar: 'pending',
  en_curso: 'driver_arriving',
  finalizado: 'completed',
  cancelado: 'cancelled',
  no_iniciado: 'not_started',
};

function option(row: AvailableTripRow, trip: Trip, match: ReturnType<typeof matchTrip>, requested: Date): TripOption {
  const departure = new Date(trip.departureTime);
  const rating = Number(row.driver_rating ?? 0);
  return {
    trip_id: row.id,
    departure: bogotaLabel(departure),
    minutes_from_requested: Math.round((departure.getTime() - requested.getTime()) / 60000),
    from: row.origen_nombre ?? '',
    to: row.destino_nombre ?? '',
    pickup_km: round(match.pickupKm),
    dropoff_km: round(match.dropoffKm),
    seats_left: trip.seatsAvailable,
    price_cop: trip.price,
    driver_first_name: (row.driver_nombre ?? '').trim().split(/\s+/)[0] ?? '',
    driver_rating: rating > 0 ? round(rating) : null,
    vehicle: row.vehicle_placa ? { brand: row.vehicle_marca ?? '', color: row.vehicle_color ?? '', plate_masked: row.vehicle_placa } : null,
    level: match.level,
    score: match.score,
    reasons: match.reasons.map((reason) => reason.kind),
    driver_note: row.descripcion ? row.descripcion.slice(0, 200) : null,
  };
}

/**
 * Ranks the visible trips for one journey: route compatibility from the app's matcher, then the
 * time window, seats and price here. Order: compatibility level, then closeness to the requested
 * time, then score.
 */
export function searchTrips(rows: AvailableTripRow[], args: SearchArgs, { now, viewerId }: { now: Date; viewerId: string }): SearchResult {
  const requested = bogotaInstant(args.date, args.time);
  const leftOut: Record<string, number> = {};
  const skip = (reason: string) => { leftOut[reason] = (leftOut[reason] ?? 0) + 1; };
  const inside: TripOption[] = [];
  const outside: TripOption[] = [];

  for (const row of rows) {
    const trip = toTrip(row);
    if (!trip) { skip('no_location'); continue; }
    const departure = new Date(trip.departureTime);
    if (departure.getTime() < now.getTime() - DEPARTED_GRACE_MIN * 60000) { skip('departed'); continue; }
    // The matcher's own time preferences use the machine's time zone; the window is applied here,
    // so the matcher is asked as if the trip left within the hour (full time score, no time exclusion).
    const match = matchTrip(trip, {
      origin: args.origin ? { latitude: args.origin.lat, longitude: args.origin.lng } : null,
      destination: { latitude: args.destination.lat, longitude: args.destination.lng },
      time: 'any',
      now: new Date(departure.getTime() - 60 * 60000),
      viewerId,
    });
    if (match.excludedBy) { skip(match.excludedBy); continue; }
    if (!match.compatible) { skip('low_compatibility'); continue; }
    if (trip.seatsAvailable < args.seats) { skip('not_enough_seats'); continue; }
    if (args.maxPrice !== null && trip.price > args.maxPrice) { skip('price'); continue; }
    const candidate = option(row, trip, match, requested);
    if (Math.abs(candidate.minutes_from_requested) <= args.flexMinutes) inside.push(candidate);
    else { skip('outside_time_window'); outside.push(candidate); }
  }

  inside.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]
    || Math.abs(a.minutes_from_requested) - Math.abs(b.minutes_from_requested)
    || b.score - a.score);
  outside.sort((a, b) => Math.abs(a.minutes_from_requested) - Math.abs(b.minutes_from_requested) || b.score - a.score);

  return {
    requested: { departure: bogotaLabel(requested), flex_minutes: args.flexMinutes, seats: args.seats, max_price_cop: args.maxPrice },
    options: inside.slice(0, MAX_OPTIONS),
    alternatives: inside.length ? [] : outside.slice(0, MAX_ALTERNATIVES),
    left_out: leftOut,
    total_visible: rows.length,
  };
}

/** trip_details: one visible trip, the same fields as a search option (no route fit without a journey). */
export function tripDetails(row: AvailableTripRow | null) {
  if (!row) return { found: false as const };
  const departure = row.salida_at ? new Date(row.salida_at) : null;
  return {
    found: true as const,
    trip_id: row.id,
    departure: departure ? bogotaLabel(departure) : null,
    from: row.origen_nombre,
    to: row.destino_nombre,
    seats_left: Number(row.cupos_disponibles ?? 0),
    price_cop: Number(row.precio ?? 0),
    driver_first_name: (row.driver_nombre ?? '').trim().split(/\s+/)[0] ?? '',
    driver_rating: Number(row.driver_rating ?? 0) > 0 ? round(Number(row.driver_rating)) : null,
    vehicle: row.vehicle_placa ? { brand: row.vehicle_marca ?? '', color: row.vehicle_color ?? '', plate_masked: row.vehicle_placa } : null,
    status: row.estado,
    driver_note: row.descripcion ? row.descripcion.slice(0, 200) : null,
  };
}
