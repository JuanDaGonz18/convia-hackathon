import type { MapRegion } from '@/maps';

/**
 * Where maps open before they know where the user is: Chía and the
 * Universidad de La Sabana campus, with the north of Bogotá at the edge.
 * Most trips start or end there.
 */
export const CAMPUS_REGION: MapRegion = { latitude: 4.86, longitude: -74.04, latitudeDelta: 0.14, longitudeDelta: 0.14 };
