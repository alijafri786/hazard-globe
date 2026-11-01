import {
  Cartesian3,
  Cartographic,
  Credit,
  GeocodeType,
  IonGeocoderService,
  Math as CesiumMath,
  Rectangle,
  type GeocoderService,
  type Scene,
} from 'cesium'

/** A search result's own point, where the pin goes; the camera flies to the area around it. */
export interface Place {
  name: string
  /** Short enough for a label on the globe or a button */
  label: string
  lon: number
  lat: number
  /** HTML credit for the place data, shown with the pin */
  attribution?: string
}

/** Keyed by a result's destination, which is all Cesium hands on once a search succeeds */
export const places = new WeakMap<Rectangle | Cartesian3, Place>()

// A street or building is framed as MIN_SPAN_DEG across, so the camera doesn't fly into the ground. Anything
// bigger than MAX_SPAN_DEG (a country with far-flung territories, say) is framed as WIDE_SPAN_DEG round its centre.
const MIN_SPAN_DEG = 0.2
const MAX_SPAN_DEG = { lon: 90, lat: 60 }
const WIDE_SPAN_DEG = 20

const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180

function around(lon: number, lat: number, spanDeg: number): Rectangle {
  const h = spanDeg / 2
  // west > east is how Cesium spells an area crossing the antimeridian
  return Rectangle.fromDegrees(wrapLon(lon - h), Math.max(-90, lat - h), wrapLon(lon + h), Math.min(90, lat + h))
}

function result(destination: Rectangle, place: Place): GeocoderService.Result {
  places.set(destination, place)
  return { displayName: place.name, destination }
}

const NUMBER = String.raw`([+-]?\d+(?:\.\d+)?)\s*°?\s*([NSEW])?`
const COORDINATES = new RegExp(`^${NUMBER}[\\s,;]+${NUMBER}$`, 'i')

/**
 * "48.8566, 2.3522", "48.8566 2.3522" or "48.86N 2.35E", latitude first as maps usually write it.
 * Hemisphere letters can come in either order. Unlettered numbers that only make sense as longitude, latitude
 * (a first number beyond ±90) are taken that way round.
 */
export function parseCoordinates(query: string): { lon: number; lat: number } | null {
  const m = query.trim().match(COORDINATES)
  if (!m) return null
  const [, a, aDir, b, bDir] = m
  let lat: number
  let lon: number
  if (aDir && bDir) {
    const isLat = (d: string) => /[NS]/i.test(d)
    if (isLat(aDir) === isLat(bDir) || a.startsWith('-') || b.startsWith('-')) return null
    const signed = (n: string, d: string) => (/[SW]/i.test(d) ? -Number(n) : Number(n))
    ;[lat, lon] = isLat(aDir) ? [signed(a, aDir), signed(b, bDir)] : [signed(b, bDir), signed(a, aDir)]
  } else if (aDir || bDir) {
    return null
  } else {
    ;[lat, lon] = [Number(a), Number(b)]
    if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) [lat, lon] = [lon, lat]
  }
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lon, lat } : null
}

export const formatCoordinates = (lon: number, lat: number) =>
  `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(4)}° ${lon < 0 ? 'W' : 'E'}`

/** Typed coordinates, so any spot can be found with or without a place name. Also suggests itself as you type. */
export class CoordinateGeocoderService implements GeocoderService {
  readonly credit = undefined

  async geocode(query: string): Promise<GeocoderService.Result[]> {
    const point = parseCoordinates(query)
    if (!point) return []
    const name = formatCoordinates(point.lon, point.lat)
    return [result(around(point.lon, point.lat, MIN_SPAN_DEG), { ...point, name, label: name })]
  }
}

interface NominatimPlace {
  lat: string
  lon: string
  display_name: string
  /** south, north, west, east */
  boundingbox: [string, string, string, string]
}

const NOMINATIM = 'https://nominatim.openstreetmap.org/search'
const OSM_CREDIT =
  'Search © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'
const MIN_INTERVAL_MS = 1_100
const CACHE_SIZE = 50

/**
 * Place search from OpenStreetMap's Nominatim, used when there's no Cesium ion token. Kept within its usage
 * policy (https://operations.osmfoundation.org/policies/nominatim/): no searching as you type, at most one
 * request a second from each browser, repeat searches answered from a cache, and the OSM credit on screen.
 */
export class NominatimGeocoderService implements GeocoderService {
  readonly credit = new Credit(OSM_CREDIT, true)
  private readonly cache = new Map<string, GeocoderService.Result[]>()
  private nextRequestAt = 0

  async geocode(query: string, type = GeocodeType.SEARCH): Promise<GeocoderService.Result[]> {
    if (type === GeocodeType.AUTOCOMPLETE) return []
    const key = query.trim().replace(/\s+/g, ' ').toLowerCase()
    const cached = this.cache.get(key)
    if (cached) return cached

    const wait = this.nextRequestAt - Date.now()
    this.nextRequestAt = Math.max(Date.now(), this.nextRequestAt) + MIN_INTERVAL_MS
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))

    // The browser's own Referer and Accept-Language identify the app and pick the language of place names
    const url = `${NOMINATIM}?${new URLSearchParams({ q: key, format: 'jsonv2', limit: '1' })}`
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`Nominatim answered ${res.status}`)
    const found = ((await res.json()) as NominatimPlace[]).map((p) => {
      const place = {
        name: p.display_name,
        label: firstPart(p.display_name),
        lon: Number(p.lon),
        lat: Number(p.lat),
        attribution: OSM_CREDIT,
      }
      const [south, north, west, east] = p.boundingbox.map(Number)
      const lonSpan = east - west
      const latSpan = north - south
      const destination =
        lonSpan > MAX_SPAN_DEG.lon || latSpan > MAX_SPAN_DEG.lat
          ? around(place.lon, place.lat, WIDE_SPAN_DEG)
          : lonSpan < MIN_SPAN_DEG && latSpan < MIN_SPAN_DEG
            ? around(place.lon, place.lat, MIN_SPAN_DEG)
            : Rectangle.fromDegrees(west, south, east, north)
      return result(destination, place)
    })

    if (this.cache.size >= CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!)
    this.cache.set(key, found)
    return found
  }
}

/** Cesium ion's geocoder, which suggests places as you type. It needs the scene, so it's made on first use. */
export class LazyIonGeocoderService implements GeocoderService {
  private service?: IonGeocoderService

  constructor(private readonly scene: () => Scene | undefined) {}

  get credit() {
    return this.service?.credit
  }

  async geocode(query: string, type?: GeocodeType): Promise<GeocoderService.Result[]> {
    const scene = this.scene()
    if (!scene) return []
    this.service ??= new IonGeocoderService({ scene })
    const found = await this.service.geocode(query, type)
    // ion gives an area or a point, not both: the pin goes in the middle
    for (const r of found) {
      places.set(r.destination, { ...centreOf(r.destination), name: r.displayName, label: firstPart(r.displayName) })
    }
    return found
  }
}

/** "Paris, Île-de-France, France" -> "Paris" */
const firstPart = (name: string) => name.split(',')[0].trim()

function centreOf(destination: Rectangle | Cartesian3) {
  const c = destination instanceof Rectangle ? Rectangle.center(destination) : Cartographic.fromCartesian(destination)
  return { lon: CesiumMath.toDegrees(c.longitude), lat: CesiumMath.toDegrees(c.latitude) }
}
