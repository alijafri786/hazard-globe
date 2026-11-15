import {
  Cartesian3,
  Color,
  Credit,
  CustomDataSource,
  Entity,
  HeightReference,
  Math as CesiumMath,
  NearFarScalar,
  type ImageryLayer,
  type Viewer,
} from 'cesium'
import { onBeforeUnmount, ref, shallowRef, watch, type ShallowRef } from 'vue'
import { api } from '../services/api'
import { addGridLayer, gridImage } from '../services/gridOverlay'
import { escapeHtml } from '../services/html'
import { ramp, SEQUENTIAL } from '../services/ramps'
import type { FireDetection } from '../types'
import type { useTimeline } from './useTimeline'

export const FIRMS_URL = 'https://firms.modaps.eosdis.nasa.gov/map/'

/** Single fires by their power (MW): the same ramp as the heat map, three steps of it */
export const FRP_BANDS = [
  { upTo: 10, colour: SEQUENTIAL[1], label: 'Under 10 MW' },
  { upTo: 50, colour: SEQUENTIAL[2], label: '10–50 MW' },
  { upTo: Infinity, colour: SEQUENTIAL[4], label: 'Over 50 MW' },
] as const

/** Below this height the heat map gives way to single fires */
const POINTS_BELOW_M = 1_500_000
const REFRESH_MS = 30 * 60_000 // FIRMS is asked at most every 30 minutes by the server

function describe(d: FireDetection): string {
  const when = new Date(d.time).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
  const rows = [
    ['Seen', `${when} UTC, by ${d.day ? 'day' : 'night'}`],
    ['Power', `${d.frp.toFixed(1)} MW`],
    ['Confidence', d.confidence],
    ['Satellite', d.satellite === 'N20' ? 'NOAA-20' : d.satellite === 'N21' ? 'NOAA-21' : d.satellite],
  ]
  const table = rows.map(([k, v]) => `<tr><th>${k}</th><td>${escapeHtml(v)}</td></tr>`).join('')
  return `<table class="cesium-infoBox-defaultTable">${table}</table>
    <p style="font-size:13px">A hot spot about 375 m across: usually a fire, sometimes a flare, a volcano or a hot roof.</p>
    <p style="opacity:.7;font-size:12px">Source: NASA FIRMS (VIIRS). Not an official warning.</p>`
}

/**
 * The last day's fires from NASA FIRMS, through the server (which needs a FIRMS key): a heat map from afar,
 * single fires with their power and time close up. Live only.
 */
export function useFirmsLayer(viewer: ShallowRef<Viewer | null>, timeline: ReturnType<typeof useTimeline>) {
  const enabled = ref(false)
  /** null until asked; false when the server has no FIRMS key */
  const available = ref<boolean | null>(null)
  const count = ref<number | null>(null)
  const fetchedAt = ref<string | null>(null)
  const scaleMax = ref<number | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** single fires are showing (zoomed in), not the heat map */
  const close = ref(false)

  const credit = new Credit(`Fires: <a href="${FIRMS_URL}" target="_blank" rel="noopener">NASA FIRMS</a>`)
  const points = new CustomDataSource('firms-fires')
  let heat: ImageryLayer | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let removeMoveEnd: (() => void) | undefined
  let latestBox = 0

  const live = () => enabled.value && timeline.mode.value === 'live'

  function show() {
    if (heat) heat.show = live() && !close.value
    points.show = live() && close.value
    viewer.value?.scene.requestRender()
  }

  async function loadGrid() {
    clearTimeout(timer)
    const v = viewer.value
    if (!v || !live()) return show()
    loading.value = true
    error.value = null
    try {
      const grid = await api.firesGrid()
      if (!grid) {
        available.value = false
        return
      }
      available.value = true
      const bin = atob(grid.data)
      const counts = new Uint16Array(grid.cols * grid.rows)
      for (let i = 0; i < counts.length; i++) counts[i] = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)
      const nonzero = [...counts].filter((c) => c > 0).sort((a, b) => a - b)
      const top = Math.max(2, nonzero.length ? nonzero[Math.floor(nonzero.length * 0.99)] : 2)
      if (heat) v.imageryLayers.remove(heat, true)
      heat = addGridLayer(v, gridImage({ cols: grid.cols, rows: grid.rows, value: (i) => counts[i] }, ramp(SEQUENTIAL, { min: 1, max: top })), credit)
      count.value = grid.count
      fetchedAt.value = grid.fetchedAt
      scaleMax.value = top
      void loadPoints()
    } catch (err) {
      error.value = (err as Error).message
    } finally {
      loading.value = false
      show()
      if (live()) timer = setTimeout(() => void loadGrid(), REFRESH_MS)
    }
  }

  /** Close up, the single fires in view: the server answers boxes up to 10° by 10° */
  async function loadPoints() {
    const v = viewer.value
    if (!v || !live() || !available.value) return
    const rect = v.camera.computeViewRectangle()
    const height = v.camera.positionCartographic.height
    const deg = (r: number) => CesiumMath.toDegrees(r)
    const box = rect ? ([deg(rect.west), deg(rect.south), deg(rect.east), deg(rect.north)] as [number, number, number, number]) : null
    const width = box ? (box[2] >= box[0] ? box[2] - box[0] : box[2] + 360 - box[0]) : Infinity
    close.value = Boolean(box && height < POINTS_BELOW_M && width <= 10 && box[3] - box[1] <= 10)
    show()
    if (!close.value || !box) return
    const request = ++latestBox
    try {
      const { detections } = await api.fires(box)
      if (request !== latestBox) return
      points.entities.removeAll()
      for (const d of detections) {
        const band = FRP_BANDS.find((b) => d.frp < b.upTo)!
        points.entities.add(
          new Entity({
            name: `Fire, ${d.frp.toFixed(0)} MW`,
            position: Cartesian3.fromDegrees(d.lon, d.lat),
            description: describe(d),
            point: {
              pixelSize: 7,
              color: Color.fromCssColorString(band.colour),
              outlineColor: Color.BLACK.withAlpha(0.5),
              outlineWidth: 1,
              heightReference: HeightReference.CLAMP_TO_GROUND,
              scaleByDistance: new NearFarScalar(1e4, 1.4, 1.5e6, 0.8),
            },
          }),
        )
      }
      show()
    } catch (err) {
      if (request === latestBox) error.value = (err as Error).message
    }
  }

  watch(
    viewer,
    (v) => {
      if (!v) return
      void v.dataSources.add(points)
      removeMoveEnd = v.camera.moveEnd.addEventListener(() => void loadPoints())
    },
    { immediate: true },
  )
  watch([enabled, timeline.mode], () => {
    show()
    if (live()) void loadGrid()
    else clearTimeout(timer)
  })

  onBeforeUnmount(() => {
    clearTimeout(timer)
    removeMoveEnd?.()
    if (heat) viewer.value?.imageryLayers.remove(heat, true)
    viewer.value?.dataSources.remove(points, true)
  })

  return { enabled, available, count, fetchedAt, scaleMax, close, loading, error }
}
