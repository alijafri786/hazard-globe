import { Credit, ImageryLayer, WebMapServiceImageryProvider, WebMercatorTilingScheme, type Viewer } from 'cesium'
import { ref, watch, type ShallowRef } from 'vue'
import type { useTimeline } from './useTimeline'

/**
 * GloFAS flood forecasts from the Copernicus Emergency Management Service, as map images straight from
 * its public WMS. Licence: CEMS-FLOODS, which allows showing them with the credit below, and says they
 * are for information only and not a flood warning. Kept light on their server: browsers fetch tiles
 * directly (nothing proxied or stored here), in large tiles, and no deeper than GloFAS's ~5 km grid needs.
 */
const OWS = 'https://ows.globalfloods.eu/glofas-ows/ows.py'
export const GLOFAS_URL = 'https://global-flood.emergency.copernicus.eu'

export const FORECAST_LAYERS = {
  summary: { name: 'FloodSummary1_30', label: 'Flood summary, next 15 days' },
  points: { name: 'reportingPoints', label: 'River reporting points' },
} as const
export type ForecastLayer = keyof typeof FORECAST_LAYERS

export const forecastCredit = () =>
  `Flood forecast generated using Copernicus Emergency Management Service information ${new Date().getUTCFullYear()}`

const child = (el: Element, name: string) => [...el.children].find((c) => c.localName === name)

/** The latest forecast run, as GloFAS advertises it. Reporting points need it spelled out in every request. */
async function latestForecast(): Promise<string> {
  const res = await fetch(`${OWS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities`)
  if (!res.ok) throw new Error(`GloFAS answered ${res.status}`)
  const xml = new DOMParser().parseFromString(await res.text(), 'text/xml')
  for (const layer of xml.getElementsByTagNameNS('*', 'Layer')) {
    if (child(layer, 'Name')?.textContent !== FORECAST_LAYERS.points.name) continue
    const time = child(layer, 'Dimension')?.getAttribute('default')
    if (time) return time
  }
  throw new Error('GloFAS did not say which forecast is the latest')
}

export function useFloodForecastLayer(viewer: ShallowRef<Viewer | null>, timeline: ReturnType<typeof useTimeline>) {
  const enabled = ref<Record<ForecastLayer, boolean>>({ summary: false, points: false })
  /** When the forecast shown was issued (ISO date), once known */
  const issued = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const layers: Partial<Record<ForecastLayer, ImageryLayer>> = {}
  let forecast: Promise<string> | null = null
  const credit = new Credit(
    `${forecastCredit()} (<a href="${GLOFAS_URL}" target="_blank" rel="noopener">GloFAS</a>)`,
    true, // on screen, not tucked away in the credits pop-up
  )

  function createLayer(key: ForecastLayer, time: string): ImageryLayer {
    return new ImageryLayer(
      new WebMapServiceImageryProvider({
        url: OWS,
        layers: FORECAST_LAYERS[key].name,
        parameters: { version: '1.3.0', format: 'image/png', transparent: true, styles: '', time },
        // Web Mercator keeps symbols in shape on the globe; lat/lon tiles stretch them away from the equator
        tilingScheme: new WebMercatorTilingScheme(),
        crs: 'EPSG:3857',
        tileWidth: 512, // fewer requests, and fewer point symbols cut off at tile edges
        tileHeight: 512,
        // The flood grid is ~5 km, so ~2 km per pixel (level 5) is all it needs; beyond that the globe just
        // magnifies. Point symbols turn to blocks when magnified, so they go a little deeper.
        maximumLevel: key === 'summary' ? 5 : 8,
        enablePickFeatures: false, // no GetFeatureInfo request to GloFAS on every click
        credit,
      }),
      { alpha: key === 'summary' ? 0.85 : 1 },
    )
  }

  /** Puts the map in line with what's switched on. Hidden while viewing history: it is today's forecast. */
  async function sync() {
    const v = viewer.value
    if (!v) return
    const live = timeline.mode.value === 'live'
    const wanted = (Object.keys(FORECAST_LAYERS) as ForecastLayer[]).filter((k) => enabled.value[k] && live)

    if (wanted.some((k) => !layers[k])) {
      loading.value = true
      error.value = null
      try {
        forecast ??= latestForecast()
        const time = await forecast
        issued.value = time
        for (const k of wanted) {
          if (layers[k]) continue
          layers[k] = createLayer(k, time)
          v.imageryLayers.add(layers[k]) // above the base map, under event markers
        }
      } catch (err) {
        forecast = null // try again next time
        error.value = `Couldn't load the GloFAS forecast: ${(err as Error).message}`
      } finally {
        loading.value = false
      }
    }

    for (const k of Object.keys(layers) as ForecastLayer[]) layers[k]!.show = enabled.value[k] && live
    v.scene.requestRender()
  }

  watch([viewer, enabled, timeline.mode], () => void sync(), { deep: true, immediate: true })

  return { enabled, issued, loading, error }
}
