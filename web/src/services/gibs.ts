import { Credit, WebMapTileServiceImageryProvider, WebMercatorTilingScheme } from 'cesium'
import type { GibsLayerInfo } from '../layers/gibs'

/** GIBS's map tiles, straight from the browser: no key, open CORS, NASA's open data policy */
const WMTS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best'

export const gibsCredit = new Credit(
  'Imagery: <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">NASA EOSDIS GIBS</a>',
)

const tileUrl = (info: GibsLayerInfo, time: string) =>
  `${WMTS}/${info.layer}/default/${time}/${info.tileMatrixSet}/0/0/0.png`

const DAY = 86_400_000
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10)

/**
 * The newest day GIBS has for a layer: asked for its one level-0 tile at time "default", it says in
 * a header which day that is. Remembered for an hour per layer, since days arrive about daily.
 */
const latest = new Map<string, { at: number; day: Promise<string> }>()
export function latestDay(info: GibsLayerInfo, now = Date.now()): Promise<string> {
  const hit = latest.get(info.layer)
  if (hit && now - hit.at < 3_600_000) return hit.day
  const day = fetch(tileUrl(info, 'default')).then((res) => {
    const actual = res.headers.get('layer-time-actual')?.slice(0, 10)
    if (!res.ok || !actual || !/^\d{4}-\d{2}-\d{2}$/.test(actual)) throw new Error(`GIBS has no ${info.layer} now`)
    return actual
  })
  latest.set(info.layer, { at: now, day })
  day.catch(() => latest.get(info.layer)?.day === day && latest.delete(info.layer))
  return day
}

/**
 * The day to show for a past date: that day, or one of the two before it, whichever GIBS has (its daily
 * layers have the odd missing day). Null when it has none of them.
 */
export async function dayOnOrBefore(info: GibsLayerInfo, day: number): Promise<string | null> {
  for (let back = 0; back <= 2; back++) {
    const candidate = isoDay(day - back * DAY)
    const res = await fetch(tileUrl(info, candidate), { method: 'HEAD' }).catch(() => null)
    if (res?.ok) return candidate
  }
  return null
}

/** Tiles for one day of a layer, in Web Mercator like GIBS serves them, no deeper than the data goes */
export function gibsProvider(info: GibsLayerInfo, day: string): WebMapTileServiceImageryProvider {
  return new WebMapTileServiceImageryProvider({
    // Cesium fills in {Time} (from dimensions) and the tile's place, but not {Layer}: that goes in as it is
    url: `${WMTS}/${info.layer}/default/{Time}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png`,
    layer: info.layer,
    style: 'default',
    format: 'image/png',
    tileMatrixSetID: info.tileMatrixSet,
    tilingScheme: new WebMercatorTilingScheme(),
    maximumLevel: info.maximumLevel,
    dimensions: { Time: day },
    credit: gibsCredit,
  })
}
