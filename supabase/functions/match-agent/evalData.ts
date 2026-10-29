/**
 * The evaluation world (evals/matching-agent/fixture.json) as the agent's data sources, in memory:
 * what each fixture account would see through RLS (its organization only, masked plates), its
 * saved places and its active requests. Time is the fixture's: day 0 is BASE_DAY, "now" 06:00.
 * Used by the fixture test and by the function's eval mode (no real accounts involved).
 */
import fixture from '../../../evals/matching-agent/fixture.json' with { type: 'json' };
import { matchKnownPlaces, type SavedPlaceRow } from './places.ts';
import { type AvailableTripRow, bogotaInstant } from './search.ts';
import type { ToolData } from './tools.ts';
import type { VerifyData } from './verify.ts';

export type Fixture = typeof fixture;
export const FIXTURE = fixture as Fixture;

/** Day 0 of the evaluation. */
export const BASE_DAY = '2026-11-02';
export const dayDate = (day: number) => new Date(Date.parse(`${BASE_DAY}T12:00:00Z`) + day * 86_400_000).toISOString().slice(0, 10);
export const instant = (day: number, time: string) => bogotaInstant(dayDate(day), time);
export const FIXTURE_NOW = instant(FIXTURE.now.day, FIXTURE.now.time);

export function place(name: string) {
  const found = matchKnownPlaces(name);
  if (found.length !== 1) throw new Error(`"${name}" must resolve to exactly one known place`);
  return found[0];
}

const driverByKey = new Map(FIXTURE.drivers.map((driver) => [driver.key, driver]));
const accounts = [...FIXTURE.drivers, ...FIXTURE.passengers] as { key: string; org: string }[];
export const orgOf = (key: string) => accounts.find((account) => account.key === key)?.org ?? null;

/** What available_trips returns to an account of `org`: its organization only, masked plates. */
export function visibleRows(org: string): AvailableTripRow[] {
  return FIXTURE.trips.flatMap((trip) => {
    const driver = driverByKey.get(trip.driver)!;
    if (driver.org !== org) return [];
    const from = place(trip.from);
    const to = place(trip.to);
    return [{
      id: trip.key,
      driver_id: driver.key,
      origen_nombre: from.label, origen_lat: from.lat, origen_lng: from.lng,
      destino_nombre: to.label, destino_lat: to.lat, destino_lng: to.lng,
      salida_at: instant(trip.day, trip.time).toISOString(),
      precio: trip.price,
      cupos_disponibles: trip.seats - trip.taken_by.length,
      descripcion: (trip as { note?: string }).note ?? null,
      estado: 'por_empezar',
      driver_nombre: driver.name,
      driver_rating: driver.rating,
      driver_is_plus: false,
      vehicle_marca: driver.vehicle.brand,
      vehicle_color: driver.vehicle.color,
      vehicle_placa: `${driver.vehicle.plate[0]}••••${driver.vehicle.plate.at(-1)}`,
      ruta: null,
    }];
  });
}

/** The agent's data sources for one fixture passenger. */
export function fixtureData(passengerKey: string): ToolData & VerifyData {
  const org = orgOf(passengerKey);
  if (!org) throw new Error(`unknown fixture account ${passengerKey}`);
  const rows = visibleRows(org);
  const passenger = FIXTURE.passengers.find((p) => p.key === passengerKey);
  const saved: SavedPlaceRow[] = (passenger?.saved_places ?? []).map((s) => {
    const p = place(s.place);
    return { kind: s.kind as SavedPlaceRow['kind'], label: s.label, address: p.label, lat: p.lat, lng: p.lng };
  });
  const tripByKey = new Map(FIXTURE.trips.map((trip) => [trip.key, trip]));
  const active = [
    ...FIXTURE.requests.filter((request) => request.passenger === passengerKey).map((request) => request.trip),
    ...FIXTURE.trips.filter((trip) => (trip.taken_by as string[]).includes(passengerKey)).map((trip) => trip.key),
  ].map((key) => ({ trip_id: key, salida_at: instant(tripByKey.get(key)!.day, tripByKey.get(key)!.time).toISOString() }));
  return {
    availableTrips: async () => rows,
    availableTrip: async (id) => rows.find((row) => row.id === id) ?? null,
    savedPlaces: async () => saved,
    myActiveRequests: async () => active,
    institutionVerified: async () => true,
  };
}
