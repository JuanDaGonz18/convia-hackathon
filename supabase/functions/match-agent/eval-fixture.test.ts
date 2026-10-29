/**
 * The evaluation set (evals/matching-agent) against the real ranking: every case with an
 * ideal_search must give its expected trip, so the expected outcomes can't drift from the code.
 * Also checks that the fixture can be seeded (the database's 90-minute rules) and that every
 * place in it resolves to exactly one known place.
 * Run with `npm run test:functions`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { matchKnownPlaces } from './places.ts';
import { type AvailableTripRow, bogotaInstant, searchTrips } from './search.ts';

type Fixture = {
  now: { day: number; time: string };
  drivers: { key: string; name: string; rating: number; org: string; vehicle: { brand: string; color: string; plate: string } }[];
  passengers: { key: string; org: string; saved_places: { place: string }[] }[];
  trips: { key: string; driver: string; from: string; to: string; day: number; time: string; seats: number; price: number; taken_by: string[]; note?: string }[];
  requests: { key: string; trip: string; passenger: string; pickup: string }[];
  route_alerts: { passenger: string; from: string; to: string }[];
};
type Case = {
  id: string;
  as: string;
  expect: { type: string; trip?: string; may_offer?: string[] };
  ideal_search?: { from: string; to: string; day: number; time: string; seats?: number; max_price_cop?: number };
};

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../evals/matching-agent/${name}`, import.meta.url), 'utf8'));
const fixture = read('fixture.json') as Fixture;
const { cases } = read('cases.json') as { cases: Case[] };

/** Day 0 of the evaluation; the runner shifts it to the real date when seeding. */
const BASE_DAY = '2026-11-02';
const dayDate = (day: number) => new Date(Date.parse(`${BASE_DAY}T12:00:00Z`) + day * 86_400_000).toISOString().slice(0, 10);
const instant = (day: number, time: string) => bogotaInstant(dayDate(day), time);
const NOW = instant(fixture.now.day, fixture.now.time);

function place(name: string) {
  const found = matchKnownPlaces(name);
  assert.equal(found.length, 1, `"${name}" must resolve to exactly one known place, got ${found.map((p) => p.label).join(' | ') || 'none'}`);
  return found[0];
}

const driverByKey = new Map(fixture.drivers.map((driver) => [driver.key, driver]));

/** What available_trips returns to an account of `org`: its organization only, masked plates. */
function visibleRows(org: string): AvailableTripRow[] {
  return fixture.trips.flatMap((trip) => {
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
      descripcion: trip.note ?? null,
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

const orgOf = (key: string) => [...fixture.drivers, ...fixture.passengers].find((account) => account.key === key)!.org;

function run(entry: Case) {
  const search = entry.ideal_search!;
  const from = place(search.from);
  const to = place(search.to);
  return searchTrips(visibleRows(orgOf(entry.as)), {
    origin: { lat: from.lat, lng: from.lng },
    destination: { lat: to.lat, lng: to.lng },
    date: dayDate(search.day),
    time: search.time,
    flexMinutes: 60,
    seats: search.seats ?? 1,
    maxPrice: search.max_price_cop ?? null,
  }, { now: NOW, viewerId: `viewer-${entry.as}` });
}

describe('fixture can be seeded', () => {
  test('every place resolves to one known place', () => {
    for (const trip of fixture.trips) { place(trip.from); place(trip.to); }
    for (const request of fixture.requests) place(request.pickup);
    for (const alert of fixture.route_alerts) { place(alert.from); place(alert.to); }
    for (const passenger of fixture.passengers) for (const saved of passenger.saved_places) place(saved.place);
  });

  test("a driver's trips, and each passenger's seats, are at least 90 minutes apart", () => {
    const byAccount = new Map<string, { key: string; at: number }[]>();
    const add = (account: string, key: string, at: number) => byAccount.set(account, [...(byAccount.get(account) ?? []), { key, at }]);
    const tripByKey = new Map(fixture.trips.map((trip) => [trip.key, trip]));
    for (const trip of fixture.trips) {
      const at = instant(trip.day, trip.time).getTime();
      add(trip.driver, trip.key, at);
      for (const passenger of trip.taken_by) add(passenger, trip.key, at);
    }
    for (const request of fixture.requests) {
      const trip = tripByKey.get(request.trip)!;
      add(request.passenger, trip.key, instant(trip.day, trip.time).getTime());
    }
    for (const [account, trips] of byAccount) {
      const sorted = trips.toSorted((a, b) => a.at - b.at);
      for (let i = 1; i < sorted.length; i++) {
        assert.ok(sorted[i].at - sorted[i - 1].at >= 90 * 60000, `${account}: ${sorted[i - 1].key} and ${sorted[i].key} are less than 90 minutes apart`);
      }
    }
  });

  test('seats taken never exceed seats offered', () => {
    for (const trip of fixture.trips) assert.ok(trip.taken_by.length <= trip.seats, trip.key);
  });
});

describe('expected outcomes match the ranking', () => {
  const searchable = cases.filter((entry) => entry.ideal_search);

  test('there are about 30–40 cases, in English and Spanish', () => {
    assert.ok(cases.length >= 28 && cases.length <= 40, `${cases.length} cases`);
    assert.equal(new Set(cases.map((entry) => entry.id)).size, cases.length, 'case ids are unique');
  });

  for (const entry of searchable) {
    test(`${entry.id}: ${entry.expect.type}${entry.expect.trip ? ` ${entry.expect.trip}` : ''}`, () => {
      const result = run(entry);
      const ids = result.options.map((option) => option.trip_id);
      assert.ok(!ids.includes('T16') && !result.alternatives.some((option) => option.trip_id === 'T16'), 'another organization\'s trip is never visible');
      if (entry.expect.type === 'pick' || entry.expect.type === 'proposal') {
        assert.equal(ids[0], entry.expect.trip, `first option for ${entry.id} (got ${ids.join(', ') || 'none'}; left out ${JSON.stringify(result.left_out)})`);
      } else if (entry.expect.type === 'none') {
        assert.deepEqual(ids, [], `${entry.id} should have no option inside the window`);
        for (const key of entry.expect.may_offer ?? []) {
          assert.ok(result.alternatives.some((option) => option.trip_id === key), `${entry.id} should offer ${key} as an alternative`);
        }
      }
    });
  }
});

describe('search_trips output', () => {
  test('plates stay masked and no phone field exists', () => {
    const result = run(cases.find((entry) => entry.id === 'p01')!);
    const text = JSON.stringify(result);
    for (const driver of fixture.drivers) assert.ok(!text.includes(driver.vehicle.plate), driver.vehicle.plate);
    assert.ok(!/phone|telefono/i.test(text));
  });

  test('the injected driver note is passed as data, truncated', () => {
    const result = run(cases.find((entry) => entry.id === 'p14')!);
    assert.equal(result.options[0].trip_id, 'T13');
    assert.ok(result.options[0].driver_note!.length <= 200);
  });

  test('a full trip is left out and counted', () => {
    const result = run(cases.find((entry) => entry.id === 'n02')!);
    assert.equal(result.left_out.not_enough_seats ?? 0, 0);
    assert.ok((result.left_out.full ?? 0) >= 1, JSON.stringify(result.left_out));
  });
});
