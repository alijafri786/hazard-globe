const EARTH_RADIUS_KM = 6_371
const RAD = Math.PI / 180

/** Great-circle distance between two points in degrees, km */
export function distanceKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLat = (lat2 - lat1) * RAD
  const dLon = (lon2 - lon1) * RAD
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Where you get to along a great circle from a point, heading `bearingDeg`, after `distanceM`. Degrees. */
export function project(lon: number, lat: number, bearingDeg: number, distanceM: number): [number, number] {
  const d = distanceM / (EARTH_RADIUS_KM * 1000)
  const bearing = bearingDeg * RAD
  const lat1 = lat * RAD
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing))
  const dLon = Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2))
  const lon2 = ((((lon * RAD + dLon) / RAD + 180) % 360) + 360) % 360 - 180
  return [lon2, lat2 / RAD]
}
