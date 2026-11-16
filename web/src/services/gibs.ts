import {
  Credit,
  WebMapServiceImageryProvider,
  WebMapTileServiceImageryProvider,
  WebMercatorTilingScheme,
  type ImageryProvider,
} from 'cesium'
import type { GibsLayerInfo } from '../layers/gibs'

/** GIBS's map tiles, straight from the browser: no key, open CORS, NASA's open data policy */
const WMTS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best'
const WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi'

export const gibsCredit = new Credit(
  'Imagery: <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">NASA EOSDIS GIBS</a>',
)

const tileUrl = (info: GibsLayerInfo, time: string) =>
  `${WMTS}/${info.layer}/default/${time}/${info.tileMatrixSet}/0/0/0.png`

const DAY = 86_400_000
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10)

/**
 * Whether GIBS has a day of a layer it draws by WMS: a 16-pixel image of the world comes back as a PNG,
 * or, for a day it lacks, as an XML error (with status 200).
 */
async function wmsHas(info: GibsLayerInfo, day: string): Promise<boolean> {
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.3.0',
    LAYERS: info.layer,
    STYLES: '',
    CRS: 'EPSG:3857',
    BBOX: '-20037508,-20037508,20037508,20037508',
    WIDTH: '16',
    HEIGHT: '16',
    FORMAT: 'image/png',
    TRANSPARENT: 'true',
    TIME: day,
  })
  const res = await fetch(`${WMS}?${params}`).catch(() => null)
  return Boolean(res?.ok && res.headers.get('content-type')?.startsWith('image/'))
}

/**
 * The newest day GIBS has for a layer: asked for its one level-0 tile at time "default", it says in
 * a header which day that is. Remembered for an hour per layer, since days arrive about daily.
 */
const latest = new Map<string, { at: number; day: Promise<string> }>()
export function latestDay(info: GibsLayerInfo, now = Date.now()): Promise<string> {
  const hit = latest.get(info.layer)
  if (hit && now - hit.at < 3_600_000) return hit.day
  // A layer drawn by WMS says no day in its headers: the newest of the last three days it has
  const day =
    info.service === 'wms'
      ? dayOnOrBefore(info, now).then((d) => {
          if (!d) throw new Error(`GIBS has no ${info.layer} now`)
          return d
        })
      : fetch(tileUrl(info, 'default')).then((res) => {
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
    if (info.service === 'wms') {
      if (await wmsHas(info, candidate)) return candidate
      continue
    }
    const res = await fetch(tileUrl(info, candidate), { method: 'HEAD' }).catch(() => null)
    if (res?.ok) return candidate
  }
  return null
}

/** Tiles for one day of a layer, in Web Mercator like GIBS serves them, no deeper than the data goes */
export function gibsProvider(info: GibsLayerInfo, day: string): ImageryProvider {
  if (info.service === 'wms') {
    return new WebMapServiceImageryProvider({
      url: WMS,
      layers: info.layer,
      parameters: { version: '1.3.0', format: 'image/png', transparent: true, styles: '', time: day },
      tilingScheme: new WebMercatorTilingScheme(),
      crs: 'EPSG:3857',
      tileWidth: 512, // fewer requests, and fewer dots cut at tile edges
      tileHeight: 512,
      maximumLevel: info.maximumLevel,
      enablePickFeatures: false,
      credit: gibsCredit,
    })
  }
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
