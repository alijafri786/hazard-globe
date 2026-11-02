import type { Viewer } from 'cesium'
import { onBeforeUnmount, ref, watch, type ShallowRef } from 'vue'
import { api } from '../services/api'
import { WindParticles } from '../services/windParticles'
import type { WindGrid } from '../types'
import type { useTimeline } from './useTimeline'

export const GFS_URL = 'https://www.ncei.noaa.gov/products/weather-climate-models/global-forecast'

/** Trail colour by wind speed, m/s, from calm to storm force */
export const WIND_SCALE = {
  max: 25,
  colours: ['#3288bd', '#66c2a5', '#abdda4', '#e6f598', '#fee08b', '#fdae61', '#f46d43', '#d53e4f'],
}

const REFRESH_MS = 30 * 60_000 // the server moves to a new forecast step every 3 hours

/** Animated wind 10 m above the ground from NOAA's GFS model, drawn as moving particles over the globe. */
export function useWindLayer(viewer: ShallowRef<Viewer | null>, timeline: ReturnType<typeof useTimeline>) {
  const enabled = ref(false)
  const grid = ref<Pick<WindGrid, 'run' | 'validTime'> | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  let particles: WindParticles | null = null
  let refreshTimer: ReturnType<typeof setTimeout> | undefined

  function show() {
    if (particles && enabled.value && timeline.mode.value === 'live') particles.start()
    else particles?.stop()
  }

  async function load() {
    clearTimeout(refreshTimer)
    const v = viewer.value
    if (!v || !enabled.value) return
    loading.value = true
    error.value = null
    try {
      const next = await api.wind()
      if (!enabled.value) return
      if (particles) particles.setGrid(next)
      else {
        // Fewer on phones: they're smaller there, and slower
        const count = matchMedia('(max-width: 640px)').matches ? 1200 : 3000
        particles = new WindParticles(v, next, { count, colours: WIND_SCALE.colours, maxSpeed: WIND_SCALE.max })
      }
      grid.value = { run: next.run, validTime: next.validTime }
    } catch (err) {
      error.value = (err as Error).message
    } finally {
      loading.value = false
      show()
      if (enabled.value) refreshTimer = setTimeout(() => void load(), REFRESH_MS)
    }
  }

  watch(enabled, (on) => {
    if (on) void load()
    else {
      clearTimeout(refreshTimer)
      show()
    }
  })

  watch(timeline.mode, show)

  onBeforeUnmount(() => {
    clearTimeout(refreshTimer)
    particles?.destroy()
  })

  return { enabled, grid, loading, error }
}
