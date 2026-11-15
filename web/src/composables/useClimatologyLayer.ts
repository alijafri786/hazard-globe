import { Credit, type ImageryLayer, type Viewer } from 'cesium'
import { onBeforeUnmount, ref, shallowRef, watch, type ShallowRef } from 'vue'
import { api } from '../services/api'
import { addGridLayer, gridImage } from '../services/gridOverlay'
import { ramp, SEQUENTIAL } from '../services/ramps'
import type { ClimatologyInfo, StormClass } from '../types'

export const IBTRACS_URL = 'https://www.ncei.noaa.gov/products/international-best-track-archive'

export const STORM_CLASS_LABELS: Record<StormClass, string> = {
  all: 'Tropical storms and stronger (34+ kt)',
  hurricane: 'Hurricane or typhoon strength (64+ kt)',
  major: 'Major: Category 3+ (96+ kt)',
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** What the colours mean now: storms per decade from `min` (faintest) to `max` (darkest, and above) */
export interface ClimatologyScale {
  min: number
  max: number
}

/**
 * How often tropical cyclones have passed near each place since 1980, from NOAA's IBTrACS through the
 * server: a heat map of storms per decade within 100 km, for a strength and the whole year or one month.
 * It's about the past decades, not today, so it stays on in History mode.
 */
export function useClimatologyLayer(viewer: ShallowRef<Viewer | null>) {
  const enabled = ref(false)
  const stormClass = ref<StormClass>('all')
  /** 0 the whole year, 1–12 a month */
  const month = ref(0)
  const info = shallowRef<ClimatologyInfo | null>(null)
  const scale = shallowRef<ClimatologyScale | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const grids = new Map<string, Uint16Array>() // they change once a year: keep each one fetched
  const credit = new Credit(`Storm tracks: <a href="${IBTRACS_URL}" target="_blank" rel="noopener">NOAA IBTrACS</a>`)
  let layer: ImageryLayer | null = null
  let latestRequest = 0

  function clear() {
    if (layer) viewer.value?.imageryLayers.remove(layer, true)
    layer = null
    viewer.value?.scene.requestRender()
  }

  async function draw() {
    const v = viewer.value
    if (!v || !enabled.value) return clear()
    const request = ++latestRequest
    const key = `${stormClass.value}:${month.value}`
    loading.value = true
    error.value = null
    try {
      info.value ??= await api.climatology()
      let counts = grids.get(key)
      if (!counts) grids.set(key, (counts = await api.climatologyGrid(stormClass.value, month.value)))
      if (request !== latestRequest || !enabled.value) return

      const { cols, rows } = info.value.grids[month.value === 0 ? 0 : 1]
      if (counts.length !== cols * rows) throw new Error('Storm climatology grid is the wrong size')
      const perDecade = 10 / info.value.years
      // Stretch the colours to this grid: its 99th percentile, so a few extreme cells don't wash out the rest
      const nonzero = [...counts].filter((c) => c > 0).sort((a, b) => a - b)
      const top = nonzero.length ? nonzero[Math.floor(nonzero.length * 0.99)] : 1
      // From two storms in the period: one alone washes pale colour over half the ocean and says little
      const next = { min: 2 * perDecade, max: Math.max(3 * perDecade, top * perDecade) }
      const colour = ramp(SEQUENTIAL, { ...next, alpha: [0.2, 0.85] })
      const image = gridImage({ cols, rows, value: (i) => counts![i] * perDecade }, colour)

      clear()
      layer = addGridLayer(v, image, credit)
      scale.value = next
      v.scene.requestRender()
    } catch (err) {
      if (request === latestRequest) error.value = (err as Error).message
    } finally {
      if (request === latestRequest) loading.value = false
    }
  }

  watch([viewer, enabled, stormClass, month], () => void draw())

  onBeforeUnmount(() => {
    enabled.value = false
    clear()
  })

  return { enabled, stormClass, month, info, scale, loading, error }
}
