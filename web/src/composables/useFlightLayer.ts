import {
  BillboardCollection,
  CallbackPositionProperty,
  Cartesian3,
  Cartographic,
  Color,
  Entity,
  Math as CesiumMath,
  NearFarScalar,
  ScreenSpaceEventType,
  type ScreenSpaceEventHandler,
  type Viewer,
} from 'cesium'
import { computed, onBeforeUnmount, ref, shallowRef, watch, type ShallowRef } from 'vue'
import { api } from '../services/api'
import { escapeHtml } from '../services/html'
import type { Flight } from '../types'

const EARTH_RADIUS_M = 6_371_000
// Snapshots can be 15 minutes old without OpenSky credentials, so planes are moved along their last
// heading between snapshots. Past this, a plane may well have turned or landed: stop guessing.
const MAX_ESTIMATE_SECONDS = 20 * 60
const ESTIMATE_TICK_MS = 10_000

export const ALTITUDE_BANDS = [
  { below: 2_000, label: 'Below 2 km', colour: '#a7f3d0' },
  { below: 6_000, label: '2–6 km', colour: '#67e8f9' },
  { below: 10_000, label: '6–10 km', colour: '#60a5fa' },
  { below: Infinity, label: 'Above 10 km', colour: '#c084fc' },
] as const
const BAND_COLOURS = ALTITUDE_BANDS.map((b) => Color.fromCssColorString(b.colour))
const bandColour = (altitudeM: number) => BAND_COLOURS[ALTITUDE_BANDS.findIndex((b) => altitudeM < b.below)]

// Plane silhouette pointing north, drawn white so each billboard's colour can tint it
const PLANE_ICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="#fff" stroke="#0b1220" stroke-width="1" d="M12 1.5c.9 0 1.4 1 1.4 2.2v5.4l8.1 4.8v2.2l-8.1-2.5v4.6l2.3 1.8v1.7L12 20.8l-3.7.9V20l2.3-1.8v-4.6l-8.1 2.5v-2.2l8.1-4.8V3.7c0-1.2.5-2.2 1.4-2.2z"/></svg>',
)}`
const SCALE_BY_DISTANCE = new NearFarScalar(5e5, 1.4, 2e7, 0.5)

/** Great-circle destination from a start point, bearing and distance. */
function project(lon: number, lat: number, bearingDeg: number, distanceM: number): [number, number] {
  const d = distanceM / EARTH_RADIUS_M
  const bearing = CesiumMath.toRadians(bearingDeg)
  const lat1 = CesiumMath.toRadians(lat)
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing))
  const dLon = Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2))
  return [CesiumMath.toDegrees(CesiumMath.negativePiToPi(CesiumMath.toRadians(lon) + dLon)), CesiumMath.toDegrees(lat2)]
}

function estimatedPosition(f: Flight, ageSeconds: number, result?: Cartesian3): Cartesian3 {
  const [, , , lon, lat, altitude, velocity, track] = f
  const t = Math.min(Math.max(ageSeconds, 0), MAX_ESTIMATE_SECONDS)
  const [lon2, lat2] = velocity && track != null ? project(lon, lat, track, velocity * t) : [lon, lat]
  return Cartesian3.fromDegrees(lon2, lat2, altitude, undefined, result)
}

function describe(f: Flight, snapshotTime: string): string {
  const [icao24, callsign, country, , , altitude, velocity, track, verticalRate] = f
  const rows = [
    ['Callsign', callsign],
    ['Registered in', country],
    ['Altitude', `${altitude.toLocaleString()} m (${Math.round(altitude * 3.28084).toLocaleString()} ft)`],
    ['Speed', velocity != null ? `${Math.round(velocity * 3.6)} km/h (${Math.round(velocity * 1.94384)} kt)` : ''],
    ['Heading', track != null ? `${track}°` : ''],
    ['Climb rate', verticalRate != null ? `${verticalRate > 0 ? '+' : ''}${verticalRate} m/s` : ''],
    ['Transponder', icao24.toUpperCase()],
  ].filter(([, v]) => v)
  const table = rows.map(([k, v]) => `<tr><th>${k}</th><td>${escapeHtml(v)}</td></tr>`).join('')
  const reported = new Date(snapshotTime).toLocaleTimeString('en-GB', { timeStyle: 'short' })
  const trackUrl = `https://map.opensky-network.org/?icao=${encodeURIComponent(icao24)}`
  return `<table class="cesium-infoBox-defaultTable">${table}</table>
    <p><a href="${trackUrl}" target="_blank" rel="noopener">Live track on OpenSky ↗</a></p>
    <p style="opacity:.7;font-size:12px">Last reported at ${reported}; the position shown is estimated from speed and
    heading since then. Source: The OpenSky Network.</p>`
}

export function useFlightLayer(viewer: ShallowRef<Viewer | null>) {
  const enabled = ref(false)
  const flights = shallowRef<Flight[]>([])
  const snapshotTime = ref<string | null>(null)
  const refreshSeconds = ref<number | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const query = ref('')

  // Billboards, not entities: entities get slow well before 10,000 of them
  const billboards = new BillboardCollection()
  const byIcao = new Map<string, number>() // icao24 -> index into flights and billboards
  let selected: Entity | null = null
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  let tickTimer: ReturnType<typeof setInterval> | undefined
  const scratch = new Cartesian3()

  const ageSeconds = () => (snapshotTime.value ? (Date.now() - Date.parse(snapshotTime.value)) / 1000 : 0)

  const matches = computed(() => {
    const q = query.value.trim().toUpperCase()
    if (q.length < 2) return []
    const found: Flight[] = []
    for (const f of flights.value) {
      if (f[1].includes(q) || f[0].toUpperCase() === q) found.push(f)
      if (found.length === 25) break
    }
    return found
  })

  function render() {
    billboards.removeAll()
    byIcao.clear()
    const age = ageSeconds()
    flights.value.forEach((f, i) => {
      billboards.add({
        id: f[0],
        image: PLANE_ICON,
        position: estimatedPosition(f, age),
        color: bandColour(f[5]),
        width: 16,
        height: 16,
        // UNIT_Z keeps the rotation relative to north rather than to the screen
        alignedAxis: Cartesian3.UNIT_Z,
        rotation: -CesiumMath.toRadians(f[7] ?? 0),
        scaleByDistance: SCALE_BY_DISTANCE,
      })
      byIcao.set(f[0], i)
    })
    // keep an open info box in step with the new snapshot
    const i = selected ? byIcao.get(selected.id) : undefined
    if (selected && i !== undefined) selected.description = describe(flights.value[i], snapshotTime.value!)
    viewer.value?.scene.requestRender()
  }

  function tick() {
    if (!enabled.value || document.hidden) return
    const age = ageSeconds()
    // every plane has hit the estimate cap and stopped moving
    if (age > MAX_ESTIMATE_SECONDS + ESTIMATE_TICK_MS / 1000) return
    for (let i = 0; i < billboards.length; i++) {
      billboards.get(i).position = estimatedPosition(flights.value[i], age, scratch)
    }
    viewer.value?.scene.requestRender()
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer)
    if (!enabled.value) return
    // ask again shortly after the server is due a new snapshot
    const due = snapshotTime.value ? Date.parse(snapshotTime.value) + (refreshSeconds.value ?? 0) * 1000 + 15_000 : 0
    refreshTimer = setTimeout(() => void refresh(), Math.max(60_000, due - Date.now()))
  }

  async function refresh() {
    loading.value = true
    error.value = null
    try {
      const res = await api.flights()
      flights.value = res.flights
      snapshotTime.value = res.time
      refreshSeconds.value = res.refreshSeconds
      if (enabled.value) render()
    } catch (err) {
      error.value = (err as Error).message
    } finally {
      loading.value = false
      scheduleRefresh()
    }
  }

  function select(icao24: string) {
    const v = viewer.value
    const i = byIcao.get(icao24)
    if (!v || i === undefined) return
    const f = flights.value[i]
    selected = new Entity({
      id: icao24,
      name: f[1] || icao24.toUpperCase(),
      // follows the billboard as it moves, and across snapshots while the plane is still reported
      position: new CallbackPositionProperty((_time, result) => {
        const j = byIcao.get(icao24)
        return j === undefined ? undefined : Cartesian3.clone(billboards.get(j).position, result)
      }, false),
      description: describe(f, snapshotTime.value!),
    })
    v.selectedEntity = selected
  }

  function flyTo(f: Flight) {
    const v = viewer.value
    const i = byIcao.get(f[0])
    if (!v || i === undefined) return
    select(f[0])
    const c = Cartographic.fromCartesian(billboards.get(i).position)
    void v.camera.flyTo({ destination: Cartesian3.fromRadians(c.longitude, c.latitude, 600_000), duration: 1.6 })
  }

  watch(
    viewer,
    (v) => {
      if (!v) return
      v.scene.primitives.add(billboards)
      // Cesium's default click only selects entities, so pick our billboards first and hand everything else on
      const handler = v.screenSpaceEventHandler
      const defaultClick = handler.getInputAction(ScreenSpaceEventType.LEFT_CLICK) as
        | ((click: ScreenSpaceEventHandler.PositionedEvent) => void)
        | undefined
      handler.setInputAction((click: ScreenSpaceEventHandler.PositionedEvent) => {
        const picked = v.scene.pick(click.position)
        if (picked?.collection === billboards) select(picked.id as string)
        else defaultClick?.(click)
      }, ScreenSpaceEventType.LEFT_CLICK)
      v.selectedEntityChanged.addEventListener((entity?: Entity) => {
        if (entity !== selected) selected = null
      })
    },
    { immediate: true },
  )

  watch(enabled, (on) => {
    const v = viewer.value
    billboards.show = on
    clearInterval(tickTimer)
    if (on) {
      // reuse the last snapshot if it's still current, so toggling doesn't spend OpenSky credits
      const stale = !snapshotTime.value || ageSeconds() > (refreshSeconds.value ?? 0)
      if (stale) void refresh()
      else render()
      tickTimer = setInterval(tick, ESTIMATE_TICK_MS)
    } else {
      clearTimeout(refreshTimer)
      billboards.removeAll()
      byIcao.clear()
      if (v && selected && v.selectedEntity === selected) v.selectedEntity = undefined
    }
    v?.scene.requestRender()
  })

  onBeforeUnmount(() => {
    clearTimeout(refreshTimer)
    clearInterval(tickTimer)
  })

  const count = computed(() => flights.value.length)

  return { enabled, count, snapshotTime, refreshSeconds, loading, error, query, matches, refresh, flyTo }
}
