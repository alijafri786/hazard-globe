import { Credit, type ImageryLayer, type Viewer } from 'cesium'
import { onBeforeUnmount, ref, shallowRef, watch, type ShallowRef } from 'vue'
import { api } from '../services/api'
import { addGridLayer, gridImage } from '../services/gridOverlay'
import { ramp } from '../services/ramps'
import type { AuroraGrid, SpaceWeatherSummary } from '../types'
import type { useTimeline } from './useTimeline'

export const SWPC_URL = 'https://www.swpc.noaa.gov/products/aurora-30-minute-forecast'

/** One hue, faint to bright: how likely the aurora is overhead. Aurora is green to the eye, so green. */
export const AURORA_COLOURS = ['#1b5e20', '#2e7d32', '#43a047', '#66bb6a', '#a5d6a7'] as const
/** Below this % chance, nothing is drawn */
export const AURORA_MIN = 10
export const AURORA_MAX = 90

const REFRESH_MS = 5 * 60_000 // OVATION is rerun every few minutes; the server asks at most every 5

/** The % chance of aurora overhead at a place, from the grid */
export function auroraAt(grid: { cols: number; bytes: Uint8Array }, lon: number, lat: number): number {
  const row = Math.min(179, Math.max(0, Math.floor(90 - lat)))
  const col = Math.min(359, Math.max(0, Math.floor(lon + 180)))
  return grid.bytes[row * grid.cols + col] ?? 0
}

/**
 * NOAA's 30–90 minute aurora forecast as a green glow, with day and night shown on the globe while it's on
 * (aurora can only be seen in the dark), and the Kp index and storm scales for the Sea & space card. Live
 * only, so hidden in History mode.
 */
export function useAuroraLayer(viewer: ShallowRef<Viewer | null>, timeline: ReturnType<typeof useTimeline>) {
  const enabled = ref(false)
  const grid = shallowRef<(Omit<AuroraGrid, 'data'> & { bytes: Uint8Array }) | null>(null)
  const summary = shallowRef<SpaceWeatherSummary | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const credit = new Credit(`Aurora: <a href="${SWPC_URL}" target="_blank" rel="noopener">NOAA SWPC</a>`)
  let layer: ImageryLayer | null = null
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  let latestRequest = 0

  const live = () => enabled.value && timeline.mode.value === 'live'

  function show() {
    const v = viewer.value
    if (!v) return
    if (layer) layer.show = live()
    // Night side shaded while the aurora is up: where it can actually be seen
    v.scene.globe.enableLighting = live()
    v.scene.requestRender()
  }

  function draw(v: Viewer, g: NonNullable<typeof grid.value>) {
    if (layer) v.imageryLayers.remove(layer, true)
    const colour = ramp(AURORA_COLOURS, { min: AURORA_MIN, max: AURORA_MAX, alpha: [0.3, 0.8] })
    layer = addGridLayer(v, gridImage({ cols: g.cols, rows: g.rows, value: (i) => g.bytes[i] }, colour), credit)
  }

  async function load() {
    clearTimeout(refreshTimer)
    const v = viewer.value
    if (!v || !live()) return
    const request = ++latestRequest
    loading.value = true
    error.value = null
    try {
      const [a, s] = await Promise.all([api.aurora(), api.spaceWeather()])
      if (request !== latestRequest || !enabled.value) return
      const bytes = Uint8Array.from(atob(a.data), (c) => c.charCodeAt(0))
      if (bytes.length !== a.cols * a.rows) throw new Error('Aurora grid is the wrong size')
      grid.value = { observedAt: a.observedAt, forecastAt: a.forecastAt, cols: a.cols, rows: a.rows, bytes }
      summary.value = s
      draw(v, grid.value)
    } catch (err) {
      if (request === latestRequest) error.value = (err as Error).message
    } finally {
      if (request === latestRequest) {
        loading.value = false
        show()
        if (live()) refreshTimer = setTimeout(() => void load(), REFRESH_MS)
      }
    }
  }

  watch([viewer, enabled, timeline.mode], () => {
    show() // at once, with what's already loaded
    if (live()) void load()
    else clearTimeout(refreshTimer)
  })

  onBeforeUnmount(() => {
    enabled.value = false
    clearTimeout(refreshTimer)
    if (layer) viewer.value?.imageryLayers.remove(layer, true)
    if (viewer.value) viewer.value.scene.globe.enableLighting = false
  })

  return { enabled, grid, summary, loading, error }
}
