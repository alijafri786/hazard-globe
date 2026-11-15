/**
 * Storm climatology from NOAA's IBTrACS: how often tropical cyclones pass near each place, since 1980.
 * Shared by the offline build (build.ts) and the server that answers from its output (index.ts).
 */

/** Wind thresholds in knots (1-minute sustained): tropical storm, hurricane/typhoon, major (Category 3+) */
export const CLASSES = { all: 34, hurricane: 64, major: 96 } as const
export type StormClass = keyof typeof CLASSES
export const STORM_CLASSES = Object.keys(CLASSES) as StormClass[]
export const isStormClass = (s: string): s is StormClass => Object.hasOwn(CLASSES, s)

/** A storm counts for a cell when its track passes within this distance of the cell's centre */
export const REACH_KM = 100

/** Grid resolution in degrees: finer for the whole year, coarser per month (each has a twelfth of the storms) */
export const ANNUAL_RES = 0.5
export const MONTHLY_RES = 1

/** Slice 0 is the whole year, 1 to 12 the months */
export const SLICES = 13
export const sliceRes = (slice: number) => (slice === 0 ? ANNUAL_RES : MONTHLY_RES)
export const gridSize = (res: number) => ({ cols: Math.round(360 / res), rows: Math.round(180 / res) })

/**
 * Grids are row-major from the north: row 0 spans 90°N down to 90 - res, column 0 spans 180°W east to
 * -180 + res. Values are storms per cell over the whole period, as little-endian Uint16.
 */
export interface ClimatologyMeta {
  source: string
  citation: string
  /** first and last observation used, ISO dates */
  from: string
  to: string
  /** length of the period in years, to turn counts into storms per decade */
  years: number
  storms: number
  reachKm: number
  classes: typeof CLASSES
  built: string
  /** byte offset of each class's slices in grids.bin, in the order of STORM_CLASSES then slice 0..12 */
  layout: { class: StormClass; slice: number; res: number; cols: number; rows: number; offset: number }[]
  /** one row per storm: [sid, name, year of first point, first point index, point count] */
  stormIndex: [string, string, number, number, number][]
}

/** Bytes per point in tracks.bin: lat×100 Int16, lon×100 Int16, wind kt Uint8 (255 unknown), month Uint8 */
export const POINT_BYTES = 6
export const UNKNOWN_WIND = 255

const R = 6371
const RAD = Math.PI / 180

/** Great-circle distance in km */
export function km(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const h =
    Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Longitude into [-180, 180) */
export const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180
