/**
 * resolve_place: turns what the user typed ("Cota", "la U", "Portal Norte") into coordinates.
 * In order: the user's saved places, then well-known places of the Sabana area, then the
 * Photon geocoder limited to the area. It returns candidates, never a guess: when a name
 * fits several places the agent asks which one.
 */

export type PlaceCandidate = { label: string; lat: number; lng: number; source: 'saved' | 'known' | 'geocoder' };
export type ResolvedPlace = { query: string; candidates: PlaceCandidate[]; ambiguous: boolean };

/** What the agent can see of the user's saved places (RLS: only their own). */
export type SavedPlaceRow = { kind: 'home' | 'work' | 'university' | 'other'; label: string; address: string; lat: number; lng: number };

/** Words that name a saved place by its kind ("mi casa", "home", "my university"). */
const KIND_WORDS: Record<SavedPlaceRow['kind'], string[]> = {
  home: ['casa', 'mi casa', 'home', 'my house', 'my home'],
  work: ['trabajo', 'mi trabajo', 'oficina', 'work', 'my office', 'my work'],
  university: ['universidad', 'mi universidad', 'my university', 'university'],
  other: [],
};

type KnownPlace = { label: string; lat: number; lng: number; aliases: string[] };

/**
 * Landmarks of the area ConVía serves, at approximate public coordinates (main square or
 * campus gate). A name shared by several entries (e.g. "Bogotá") is ambiguous on purpose.
 */
export const KNOWN_PLACES: KnownPlace[] = [
  { label: 'Universidad de La Sabana, Chía', lat: 4.8616, lng: -74.0329, aliases: ['la sabana', 'unisabana', 'universidad de la sabana', 'u de la sabana', 'la u', 'campus del puente del comun'] },
  { label: 'Clínica Universidad de La Sabana, Chía', lat: 4.8571, lng: -74.0352, aliases: ['clinica de la sabana', 'clinica universidad de la sabana'] },
  { label: 'Universidad Militar Nueva Granada, Cajicá', lat: 4.9441, lng: -74.0106, aliases: ['umng', 'la militar', 'nueva granada', 'universidad militar'] },
  { label: 'Centro Comercial Fontanar, Chía', lat: 4.8833, lng: -74.0378, aliases: ['fontanar', 'cc fontanar', 'centro comercial fontanar'] },
  { label: 'Chía (parque principal)', lat: 4.8617, lng: -74.0585, aliases: ['chia', 'centro de chia', 'parque de chia'] },
  { label: 'La Caro, Chía', lat: 4.8679, lng: -74.0308, aliases: ['la caro', 'puente de la caro'] },
  { label: 'Cota (parque principal)', lat: 4.8095, lng: -74.1018, aliases: ['cota', 'centro de cota'] },
  { label: 'Cajicá (parque principal)', lat: 4.9186, lng: -74.0272, aliases: ['cajica', 'centro de cajica'] },
  { label: 'Zipaquirá (centro)', lat: 5.0221, lng: -74.0058, aliases: ['zipaquira', 'zipa'] },
  { label: 'Tenjo (parque principal)', lat: 4.8722, lng: -74.144, aliases: ['tenjo'] },
  { label: 'Tabio (parque principal)', lat: 4.9163, lng: -74.0937, aliases: ['tabio'] },
  { label: 'Sopó (parque principal)', lat: 4.9076, lng: -73.9384, aliases: ['sopo'] },
  { label: 'Portal Norte, Bogotá', lat: 4.7546, lng: -74.0463, aliases: ['portal norte', 'bogota', 'bogota norte'] },
  { label: 'Calle 100 con Autopista, Bogotá', lat: 4.6866, lng: -74.0566, aliases: ['calle 100', 'bogota'] },
  { label: 'Centro de Bogotá (Plaza de Bolívar)', lat: 4.5981, lng: -74.076, aliases: ['centro de bogota', 'plaza de bolivar', 'bogota'] },
];

/** The area the geocoder may answer in (Sabana Centro and the north of Bogotá). */
export const AREA = { minLat: 4.55, maxLat: 5.1, minLng: -74.3, maxLng: -73.85 };

export function normalize(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const inArea = ({ lat, lng }: { lat: number; lng: number }) => lat >= AREA.minLat && lat <= AREA.maxLat && lng >= AREA.minLng && lng <= AREA.maxLng;

/** Exact alias first; otherwise aliases contained in the query as whole words ("desde cota" → Cota). */
export function matchKnownPlaces(query: string): PlaceCandidate[] {
  const text = normalize(query);
  if (!text) return [];
  const exact = KNOWN_PLACES.filter((place) => place.aliases.includes(text) || normalize(place.label) === text);
  const found = exact.length ? exact : KNOWN_PLACES.filter((place) => place.aliases.some((alias) => ` ${text} `.includes(` ${alias} `)));
  return found.map(({ label, lat, lng }) => ({ label, lat, lng, source: 'known' }));
}

export function matchSavedPlaces(query: string, saved: SavedPlaceRow[]): PlaceCandidate[] {
  const text = normalize(query);
  if (!text) return [];
  const byName = saved.filter((place) => {
    const label = normalize(place.label);
    return label === text || ` ${text} `.includes(` ${label} `);
  });
  const byKind = byName.length ? [] : saved.filter((place) => KIND_WORDS[place.kind].includes(text));
  return [...byName, ...byKind].map((place) => ({ label: place.label, lat: place.lat, lng: place.lng, source: 'saved' }));
}

export type Geocoder = (query: string) => Promise<PlaceCandidate[]>;

/** Photon (OpenStreetMap), the geocoder the app already uses, biased to Chía and limited to the area. */
export function photonGeocoder(fetchImpl: typeof fetch = globalThis.fetch): Geocoder {
  return async (query) => {
    const params = new URLSearchParams({ q: query, limit: '5', lat: '4.8616', lon: '-74.0329', bbox: `${AREA.minLng},${AREA.minLat},${AREA.maxLng},${AREA.maxLat}` });
    const response = await fetchImpl(`https://photon.komoot.io/api/?${params}`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return [];
    const body = await response.json() as { features?: { geometry?: { coordinates?: [number, number] }; properties?: Record<string, string | undefined> }[] };
    return (body.features ?? []).flatMap((feature) => {
      const [lng, lat] = feature.geometry?.coordinates ?? [];
      const p = feature.properties ?? {};
      if (typeof lat !== 'number' || typeof lng !== 'number') return [];
      const label = [p.name, p.street && p.housenumber ? `${p.street} ${p.housenumber}` : p.street, p.city ?? p.county].filter(Boolean).join(', ');
      return label ? [{ label, lat, lng, source: 'geocoder' as const }] : [];
    }).filter(inArea);
  };
}

export async function resolvePlace(query: string, saved: SavedPlaceRow[], geocode?: Geocoder): Promise<ResolvedPlace> {
  const fromSaved = matchSavedPlaces(query, saved);
  if (fromSaved.length) return { query, candidates: fromSaved, ambiguous: fromSaved.length > 1 };
  const known = matchKnownPlaces(query);
  if (known.length) return { query, candidates: known, ambiguous: known.length > 1 };
  const geocoded = geocode ? await geocode(query).catch(() => []) : [];
  const candidates = geocoded.slice(0, 3);
  // The geocoder ranks by relevance; more than one result is a choice for the user.
  return { query, candidates, ambiguous: candidates.length > 1 };
}
