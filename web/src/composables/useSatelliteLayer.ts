import {
  ArcType,
  CallbackPositionProperty,
  CallbackProperty,
  Cartesian3,
  Cartographic,
  Color,
  Credit,
  Entity,
  NearFarScalar,
  PointPrimitiveCollection,
  type Viewer,
} from 'cesium'
import { computed, onBeforeUnmount, ref, shallowRef, watch, type ShallowRef } from 'vue'
import { api } from '../services/api'
import { escapeHtml } from '../services/html'
import type { OrbitalElements } from '../types'
import type { FromWorker, Selected, ToWorker } from '../workers/satellites'
import type { useGlobeClicks } from './useGlobeClicks'
import type { useTimeline } from './useTimeline'

export const CELESTRAK_URL = 'https://celestrak.org'

/** CelesTrak's groups, as offered by the server, in the order they're merged */
export const SATELLITE_GROUPS = {
  stations: 'Space stations',
  visual: 'Brightest',
  gnss: 'Navigation (GPS, Galileo…)',
  weather: 'Weather',
  starlink: 'Starlink (~11,000)',
  active: 'All active (~17,000)',
} as const
export type SatelliteGroup = keyof typeof SATELLITE_GROUPS

export const ORBIT_CLASSES = {
  LEO: { label: 'Low Earth orbit', colour: '#f8fafc' },
  MEO: { label: 'Medium (navigation)', colour: '#5eead4' },
  GEO: { label: 'Geostationary', colour: '#f9a8d4' },
  HEO: { label: 'Highly elliptical', colour: '#c4b5fd' },
} as const
type OrbitClass = keyof typeof ORBIT_CLASSES
const CLASS_COLOURS = Object.fromEntries(
  Object.entries(ORBIT_CLASSES).map(([k, v]) => [k, Color.fromCssColorString(v.colour)]),
) as Record<OrbitClass, Color>

const EARTH_RADIUS_KM = 6_378.137
const MU = 398_600.4418 // Earth's gravitational parameter, km³/s²
const TICK_MS = 1_000
/** The server refreshes from CelesTrak every 2 hours; enabled groups are fetched again once that old */
const GROUP_REFRESH_MS = 2 * 60 * 60_000
const REFRESH_CHECK_MS = 10 * 60_000
const DESCRIBE_EVERY_TICKS = 5 // the info box is rewritten, so not every second
const SCALE_BY_DISTANCE = new NearFarScalar(1e6, 1.6, 4e7, 0.7)
const scratch = new Cartesian3()

const periodMinutes = (el: OrbitalElements) => 1440 / el.MEAN_MOTION

function orbitClass(el: OrbitalElements): OrbitClass {
  if (el.ECCENTRICITY > 0.25) return 'HEO'
  const period = periodMinutes(el)
  if (period < 128) return 'LEO' // below ~2,000 km
  if (Math.abs(period - 1436) < 30) return 'GEO' // once a sidereal day
  return 'MEO'
}

/** Lowest and highest points of the orbit above the surface, km, from the mean elements */
function perigeeApogee(el: OrbitalElements): [number, number] {
  const n = (el.MEAN_MOTION * 2 * Math.PI) / 86_400 // radians a second
  const a = Math.cbrt(MU / (n * n))
  return [a * (1 - el.ECCENTRICITY) - EARTH_RADIUS_KM, a * (1 + el.ECCENTRICITY) - EARTH_RADIUS_KM]
}

const km = (n: number) => `${Math.round(n).toLocaleString()} km`

function describe(el: OrbitalElements, now?: Selected): string {
  const [perigee, apogee] = perigeeApogee(el)
  const ageDays = (Date.now() - Date.parse(`${el.EPOCH}Z`)) / 86_400_000
  const rows = [
    ['Altitude now', now ? km(now.heightKm) : ''],
    ['Speed', now ? `${now.speedKms.toFixed(2)} km/s (${Math.round(now.speedKms * 3600).toLocaleString()} km/h)` : ''],
    ['Orbit', ORBIT_CLASSES[orbitClass(el)].label],
    // Only worth saying for an oval orbit: for a round one it's the height now, give or take Earth's bulge
    ['Height range', apogee - perigee < 100 ? '' : `${km(perigee)} to ${km(apogee)}`],
    ['Once round', `${Math.round(periodMinutes(el)).toLocaleString()} minutes`],
    ['Inclination', `${el.INCLINATION.toFixed(1)}°`],
    ['NORAD number', String(el.NORAD_CAT_ID)],
    ['Launch designator', el.OBJECT_ID],
  ].filter(([, v]) => v)
  const table = rows.map(([k, v]) => `<tr><th>${k}</th><td>${escapeHtml(v)}</td></tr>`).join('')
  return `<table class="cesium-infoBox-defaultTable">${table}</table>
    <p style="opacity:.7;font-size:12px">The ring is one orbit from now. Position worked out in your browser from
    orbital elements ${ageDays < 1 ? 'less than a day' : `${Math.round(ageDays)} days`} old, good to a few km.
    Source: CelesTrak.</p>`
}

/** Satellites from CelesTrak, positioned by SGP4 in a Web Worker and moved once a second. */
export function useSatelliteLayer(
  viewer: ShallowRef<Viewer | null>,
  timeline: ReturnType<typeof useTimeline>,
  clicks: ReturnType<typeof useGlobeClicks>,
) {
  const groups = ref<Record<SatelliteGroup, boolean>>(
    Object.fromEntries(Object.keys(SATELLITE_GROUPS).map((g) => [g, false])) as Record<SatelliteGroup, boolean>,
  )
  /** How many each group has, once loaded */
  const groupCounts = ref<Partial<Record<SatelliteGroup, number>>>({})
  const satellites = shallowRef<OrbitalElements[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const query = ref('')

  // Points rather than entities or billboards: the cheapest way to draw tens of thousands of dots
  const points = new PointPrimitiveCollection()
  const byNorad = new Map<number, number>() // NORAD number -> index into satellites and points
  const loaded = new Map<SatelliteGroup, OrbitalElements[]>()
  const loadedAt = new Map<SatelliteGroup, number>()
  let refreshTimer: ReturnType<typeof setInterval> | undefined
  const credit = new Credit(`Orbits: <a href="${CELESTRAK_URL}" target="_blank" rel="noopener">CelesTrak</a>`, true)
  let creditShown = false

  let worker: Worker | null = null
  let version = 0
  let busy = false
  let ticks = 0
  let tickTimer: ReturnType<typeof setInterval> | undefined
  let selected: { entity: Entity; norad: number; orbit: Cartesian3[]; latest?: Selected } | null = null
  const orbitLine = new Entity({
    polyline: {
      positions: new CallbackProperty(() => selected?.orbit ?? [], false),
      width: 1.5,
      arcType: ArcType.NONE, // straight between points out in space, not along the ground
      material: Color.WHITE.withAlpha(0.7),
    },
  })

  const live = () => timeline.mode.value === 'live'
  const selectedIndex = () => (selected ? (byNorad.get(selected.norad) ?? -1) : -1)

  function post(msg: ToWorker) {
    worker?.postMessage(msg)
  }

  function onPositions({ data }: MessageEvent<FromWorker>) {
    busy = false
    if (data.version !== version) return
    const { positions } = data
    for (let i = 0; i < points.length; i++) {
      const p = points.get(i)
      const x = positions[i * 3]
      p.show = live() && !Number.isNaN(x)
      if (p.show) p.position = Cartesian3.fromElements(x, positions[i * 3 + 1], positions[i * 3 + 2], scratch)
    }
    if (selected && data.selected && data.selected.index === selectedIndex()) {
      const { orbit } = data.selected
      selected.orbit = Array.from({ length: orbit.length / 3 }, (_, i) =>
        Cartesian3.fromArray(orbit as unknown as number[], i * 3),
      )
      const first = !selected.latest
      selected.latest = data.selected
      if (first || ticks % DESCRIBE_EVERY_TICKS === 0) {
        selected.entity.description = describe(satellites.value[data.selected.index], data.selected)
      }
    }
    viewer.value?.scene.requestRender()
  }

  function tick() {
    if (busy || !satellites.value.length || document.hidden || !live()) return
    busy = true
    ticks++
    post({ type: 'tick', version, time: Date.now(), selected: selectedIndex() })
  }

  function showCredit(show: boolean) {
    const v = viewer.value
    if (!v || show === creditShown) return
    if (show) v.creditDisplay.addStaticCredit(credit)
    else v.creditDisplay.removeStaticCredit(credit)
    creditShown = show
  }

  /** Draws the union of the groups switched on, each satellite once */
  function render() {
    const list: OrbitalElements[] = []
    const seen = new Set<number>()
    for (const g of Object.keys(SATELLITE_GROUPS) as SatelliteGroup[]) {
      if (!groups.value[g]) continue
      for (const el of loaded.get(g) ?? []) {
        if (seen.has(el.NORAD_CAT_ID)) continue
        seen.add(el.NORAD_CAT_ID)
        list.push(el)
      }
    }
    satellites.value = list
    points.removeAll()
    byNorad.clear()
    list.forEach((el, i) => {
      points.add({
        id: el.NORAD_CAT_ID,
        show: false, // until the worker has placed it
        pixelSize: 4,
        color: CLASS_COLOURS[orbitClass(el)],
        outlineColor: Color.BLACK.withAlpha(0.6),
        outlineWidth: 1,
        scaleByDistance: SCALE_BY_DISTANCE,
      })
      byNorad.set(el.NORAD_CAT_ID, i)
    })
    if (selected && !byNorad.has(selected.norad)) deselect()

    version++
    busy = false
    if (list.length) {
      worker ??= new Worker(new URL('../workers/satellites.ts', import.meta.url), { type: 'module' })
      worker.onmessage = onPositions
      post({ type: 'set', version, elements: list })
      tick()
      tickTimer ??= setInterval(tick, TICK_MS)
    } else {
      clearInterval(tickTimer)
      tickTimer = undefined
    }
    showCredit(list.length > 0 && live())
    viewer.value?.scene.requestRender()
  }

  async function sync() {
    const wanted = (Object.keys(SATELLITE_GROUPS) as SatelliteGroup[]).filter((g) => groups.value[g] && !loaded.has(g))
    loading.value = wanted.length > 0
    error.value = null
    const results = await Promise.allSettled(
      wanted.map(async (g) => {
        const res = await api.satellites(g)
        loaded.set(g, res.satellites)
        loadedAt.set(g, Date.now())
        groupCounts.value = { ...groupCounts.value, [g]: res.satellites.length }
      }),
    )
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (failed) error.value = (failed.reason as Error).message
    loading.value = false
    render()
  }

  function deselect() {
    const v = viewer.value
    const was = selected
    selected = null
    if (was && v?.selectedEntity === was.entity) v.selectedEntity = undefined
    v?.scene.requestRender()
  }

  function select(norad: number) {
    const v = viewer.value
    const i = byNorad.get(norad)
    if (!v || i === undefined) return
    const el = satellites.value[i]
    const entity = new Entity({
      id: `satellite-${norad}`,
      name: el.OBJECT_NAME,
      // follows the point as it moves, so the info box's camera button can track the satellite
      position: new CallbackPositionProperty((_time, result) => {
        const j = byNorad.get(norad)
        return j === undefined ? undefined : Cartesian3.clone(points.get(j).position, result)
      }, false),
      description: describe(el),
    })
    selected = { entity, norad, orbit: [] }
    v.selectedEntity = entity
    ticks = 0
    busy = false
    tick() // the orbit and live figures straight away, not at the next tick
  }

  function flyTo(el: OrbitalElements) {
    const v = viewer.value
    const i = byNorad.get(el.NORAD_CAT_ID)
    if (!v || i === undefined) return
    select(el.NORAD_CAT_ID)
    const p = points.get(i)
    if (!p.show) return
    const c = Cartographic.fromCartesian(p.position)
    // From above, far enough out to take in the ring
    const range = Math.max(1.2e7, c.height * 2.5)
    void v.camera.flyTo({ destination: Cartesian3.fromRadians(c.longitude, c.latitude, c.height + range), duration: 1.6 })
  }

  const matches = computed(() => {
    const q = query.value.trim().toUpperCase()
    if (q.length < 2) return []
    const found: OrbitalElements[] = []
    for (const el of satellites.value) {
      if (el.OBJECT_NAME.toUpperCase().includes(q) || String(el.NORAD_CAT_ID) === q) found.push(el)
      if (found.length === 25) break
    }
    return found
  })

  watch(
    viewer,
    (v) => {
      if (!v) return
      v.scene.primitives.add(points)
      v.entities.add(orbitLine)
      v.selectedEntityChanged.addEventListener((entity?: Entity) => {
        if (selected && entity !== selected.entity) {
          selected = null
          v.scene.requestRender()
        }
      })
    },
    { immediate: true },
  )

  clicks.onPick((picked) => {
    if (picked?.collection !== points) return false
    select(picked.id as number)
    return true
  })

  watch(groups, () => void sync(), { deep: true })

  // Fresh elements for groups still switched on, so positions don't drift over a long session
  refreshTimer = setInterval(() => {
    let due = false
    for (const [g, at] of loadedAt) {
      if (groups.value[g] && Date.now() - at >= GROUP_REFRESH_MS) {
        loaded.delete(g)
        loadedAt.delete(g)
        due = true
      }
    }
    if (due) void sync()
  }, REFRESH_CHECK_MS)

  watch(timeline.mode, () => {
    const show = live()
    orbitLine.show = show
    if (show) {
      busy = false
      tick() // shows them again where they are now
    } else {
      for (let i = 0; i < points.length; i++) points.get(i).show = false
      deselect()
    }
    showCredit(show && satellites.value.length > 0)
    viewer.value?.scene.requestRender()
  })

  onBeforeUnmount(() => {
    clearInterval(tickTimer)
    clearInterval(refreshTimer)
    worker?.terminate()
  })

  const count = computed(() => satellites.value.length)

  return { groups, groupCounts, count, loading, error, query, matches, flyTo }
}
