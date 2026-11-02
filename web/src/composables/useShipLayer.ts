import {
  BillboardCollection,
  CallbackPositionProperty,
  Cartesian3,
  Cartographic,
  Color,
  Credit,
  Entity,
  Math as CesiumMath,
  NearFarScalar,
  type Viewer,
} from 'cesium'
import { computed, onBeforeUnmount, ref, shallowRef, watch, type ShallowRef } from 'vue'
import { api, ApiError } from '../services/api'
import { project } from '../services/geo'
import { escapeHtml } from '../services/html'
import type { Ship, ShipDetails } from '../types'
import type { useGlobeClicks } from './useGlobeClicks'
import type { useTimeline } from './useTimeline'

export const AISSTREAM_URL = 'https://aisstream.io'

/** Grouped by AIS ship type */
export const SHIP_KINDS = [
  { label: 'Cargo', colour: '#38bdf8', is: (t: number) => t >= 70 && t <= 79 },
  { label: 'Tanker', colour: '#f472b6', is: (t: number) => t >= 80 && t <= 89 },
  { label: 'Passenger', colour: '#a78bfa', is: (t: number) => t >= 60 && t <= 69 },
  { label: 'Fishing', colour: '#facc15', is: (t: number) => t === 30 },
  { label: 'Sailing and leisure', colour: '#f8fafc', is: (t: number) => t === 36 || t === 37 },
  { label: 'Other or unknown', colour: '#94a3b8', is: () => true },
] as const
const KIND_COLOURS = SHIP_KINDS.map((k) => Color.fromCssColorString(k.colour))
const kindColour = (type: number) => KIND_COLOURS[SHIP_KINDS.findIndex((k) => k.is(type))]

function typeLabel(t: number): string {
  if (t >= 20 && t <= 29) return 'Wing in ground'
  if (t >= 40 && t <= 49) return 'High-speed craft'
  if (t >= 60 && t <= 69) return 'Passenger'
  if (t >= 70 && t <= 79) return 'Cargo'
  if (t >= 80 && t <= 89) return 'Tanker'
  const named: Record<number, string> = {
    30: 'Fishing',
    31: 'Towing',
    32: 'Towing',
    33: 'Dredging or underwater operations',
    34: 'Diving operations',
    35: 'Military',
    36: 'Sailing',
    37: 'Pleasure craft',
    50: 'Pilot',
    51: 'Search and rescue',
    52: 'Tug',
    53: 'Port tender',
    55: 'Law enforcement',
    58: 'Medical transport',
  }
  return named[t] ?? (t >= 90 ? 'Other' : 'Not given')
}

const NAV_STATUS: Record<number, string> = {
  0: 'Under way, using engine',
  1: 'At anchor',
  2: 'Not under command',
  3: 'Restricted manoeuvrability',
  4: 'Constrained by draught',
  5: 'Moored',
  6: 'Aground',
  7: 'Fishing',
  8: 'Under way, sailing',
}

// A hull seen from above, bow north, drawn white so each billboard's colour can tint it
const SHIP_ICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="#fff" stroke="#0b1220" stroke-width="1.2" d="M12 2c2.6 2.8 4 6 4 9.5V21c0 .6-.4 1-1 1H9c-.6 0-1-.4-1-1v-9.5C8 8 9.4 4.8 12 2z"/></svg>',
)}`
const SCALE_BY_DISTANCE = new NearFarScalar(3e5, 1.2, 1.5e7, 0.45)
const KNOTS = 0.514444 // m/s
// Ships keep their course far longer than planes, but stop guessing after half an hour
const MAX_ESTIMATE_SECONDS = 30 * 60
const ESTIMATE_TICK_MS = 15_000
const MOVING_KNOTS = 0.5

function estimatedPosition(s: Ship, sinceSnapshotS: number, result?: Cartesian3): Cartesian3 {
  const [, , , lon, lat, sog, cog, , ageS] = s
  const t = Math.min(Math.max(ageS + sinceSnapshotS, 0), MAX_ESTIMATE_SECONDS)
  const [lon2, lat2] = sog && sog >= MOVING_KNOTS && cog !== null ? project(lon, lat, cog, sog * KNOTS * t) : [lon, lat]
  return Cartesian3.fromDegrees(lon2, lat2, 0, undefined, result)
}

function describe(s: Ship, d?: ShipDetails): string {
  const [mmsi, name, type, , , sog, cog, heading] = s
  const size = d?.lengthM && d.widthM ? `${d.lengthM} × ${d.widthM} m` : ''
  const rows = [
    ['Name', name || d?.name || ''],
    ['Type', typeLabel(d?.type ?? type)],
    ['Status', d?.navStatus != null ? (NAV_STATUS[d.navStatus] ?? '') : ''],
    ['Speed', sog != null ? `${sog.toFixed(1)} kn (${Math.round(sog * 1.852)} km/h)` : ''],
    ['Course', cog != null ? `${cog}°` : ''],
    ['Heading', heading != null ? `${heading}°` : ''],
    ['Destination', d?.destination ?? ''],
    ['Size', size],
    ['Call sign', d?.callSign ?? ''],
    ['IMO number', d?.imo ? String(d.imo) : ''],
    ['MMSI', String(mmsi)],
  ].filter(([, v]) => v)
  const table = rows.map(([k, v]) => `<tr><th>${k}</th><td>${escapeHtml(v)}</td></tr>`).join('')
  const reported = d ? new Date(d.seenAt).toLocaleTimeString('en-GB', { timeStyle: 'short' }) : null
  return `<table class="cesium-infoBox-defaultTable">${table}</table>
    <p style="opacity:.7;font-size:12px">${reported ? `Last reported at ${reported}. ` : ''}The position shown is
    estimated from speed and course since the last report. The destination is typed in by the crew. AIS via
    AISStream.io.</p>`
}

/** Ships from the server's AISStream feed, moved along their course between snapshots. */
export function useShipLayer(
  viewer: ShallowRef<Viewer | null>,
  timeline: ReturnType<typeof useTimeline>,
  clicks: ReturnType<typeof useGlobeClicks>,
) {
  const enabled = ref(false)
  const ships = shallowRef<Ship[]>([])
  const snapshotTime = ref<string | null>(null)
  const collectingSince = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** The server has no AISStream key */
  const unavailable = ref(false)
  const query = ref('')

  const billboards = new BillboardCollection()
  const byMmsi = new Map<number, number>()
  const credit = new Credit(`Ships: <a href="${AISSTREAM_URL}" target="_blank" rel="noopener">AISStream.io</a>`, true)
  let creditShown = false
  let selected: { entity: Entity; mmsi: number; details?: ShipDetails } | null = null
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  let tickTimer: ReturnType<typeof setInterval> | undefined
  let refreshSeconds = 120
  const scratch = new Cartesian3()

  const live = () => timeline.mode.value === 'live'
  const sinceSnapshot = () => (snapshotTime.value ? (Date.now() - Date.parse(snapshotTime.value)) / 1000 : 0)

  function showLayer() {
    const show = enabled.value && live()
    billboards.show = show
    const v = viewer.value
    if (v && show !== creditShown) {
      if (show) v.creditDisplay.addStaticCredit(credit)
      else v.creditDisplay.removeStaticCredit(credit)
      creditShown = show
    }
    v?.scene.requestRender()
  }

  function render() {
    billboards.removeAll()
    byMmsi.clear()
    const since = sinceSnapshot()
    ships.value.forEach((s, i) => {
      const heading = s[7] ?? s[6]
      billboards.add({
        id: s[0],
        image: SHIP_ICON,
        position: estimatedPosition(s, since),
        color: kindColour(s[2]),
        width: 14,
        height: 14,
        alignedAxis: Cartesian3.UNIT_Z, // rotation relative to north, not the screen
        rotation: -CesiumMath.toRadians(heading ?? 0),
        scaleByDistance: SCALE_BY_DISTANCE,
      })
      byMmsi.set(s[0], i)
    })
    if (selected) {
      const i = byMmsi.get(selected.mmsi)
      if (i !== undefined) selected.entity.description = describe(ships.value[i], selected.details)
    }
    viewer.value?.scene.requestRender()
  }

  function tick() {
    if (!enabled.value || document.hidden || !live()) return
    const since = sinceSnapshot()
    ships.value.forEach((s, i) => {
      if (s[5] && s[5] >= MOVING_KNOTS) billboards.get(i).position = estimatedPosition(s, since, scratch)
    })
    viewer.value?.scene.requestRender()
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer)
    if (!enabled.value || unavailable.value) return
    refreshTimer = setTimeout(() => void refresh(), refreshSeconds * 1000 + 5_000)
  }

  async function refresh() {
    loading.value = true
    error.value = null
    try {
      const res = await api.ships()
      ships.value = res.ships
      snapshotTime.value = res.time
      collectingSince.value = res.collectingSince
      refreshSeconds = res.refreshSeconds
      error.value = res.error
      if (enabled.value) render()
    } catch (err) {
      if (err instanceof ApiError && err.status === 501) unavailable.value = true
      else error.value = (err as Error).message
    } finally {
      loading.value = false
      scheduleRefresh()
    }
  }

  function select(mmsi: number) {
    const v = viewer.value
    const i = byMmsi.get(mmsi)
    if (!v || i === undefined) return
    const s = ships.value[i]
    const entity = new Entity({
      id: `ship-${mmsi}`,
      name: s[1] || `MMSI ${mmsi}`,
      position: new CallbackPositionProperty((_time, result) => {
        const j = byMmsi.get(mmsi)
        return j === undefined ? undefined : Cartesian3.clone(billboards.get(j).position, result)
      }, false),
      description: describe(s),
    })
    selected = { entity, mmsi }
    v.selectedEntity = entity
    // Destination, size and the like aren't in the snapshot: ask for them
    void api
      .ship(mmsi)
      .then((details) => {
        if (selected?.mmsi !== mmsi) return
        selected.details = details
        const j = byMmsi.get(mmsi)
        if (j !== undefined) entity.description = describe(ships.value[j], details)
        if (details.name && !s[1]) entity.name = details.name
      })
      .catch(() => {})
  }

  function flyTo(s: Ship) {
    const v = viewer.value
    const i = byMmsi.get(s[0])
    if (!v || i === undefined) return
    select(s[0])
    const c = Cartographic.fromCartesian(billboards.get(i).position)
    void v.camera.flyTo({ destination: Cartesian3.fromRadians(c.longitude, c.latitude, 150_000), duration: 1.6 })
  }

  const matches = computed(() => {
    const q = query.value.trim().toUpperCase()
    if (q.length < 2) return []
    const found: Ship[] = []
    for (const s of ships.value) {
      if (s[1].includes(q) || String(s[0]) === q) found.push(s)
      if (found.length === 25) break
    }
    return found
  })

  watch(
    viewer,
    (v) => {
      if (!v) return
      v.scene.primitives.add(billboards)
      billboards.show = false
      v.selectedEntityChanged.addEventListener((entity?: Entity) => {
        if (selected && entity !== selected.entity) selected = null
      })
    },
    { immediate: true },
  )

  clicks.onPick((picked) => {
    if (picked?.collection !== billboards) return false
    select(picked.id as number)
    return true
  })

  watch(enabled, (on) => {
    clearInterval(tickTimer)
    clearTimeout(refreshTimer)
    if (on) {
      const stale = !snapshotTime.value || sinceSnapshot() > refreshSeconds
      if (stale) void refresh()
      else render()
      tickTimer = setInterval(tick, ESTIMATE_TICK_MS)
    } else {
      billboards.removeAll()
      byMmsi.clear()
      const v = viewer.value
      if (v && selected && v.selectedEntity === selected.entity) v.selectedEntity = undefined
    }
    showLayer()
  })

  watch(timeline.mode, () => {
    const v = viewer.value
    if (!live() && v && selected && v.selectedEntity === selected.entity) v.selectedEntity = undefined
    if (live()) tick()
    showLayer()
  })

  onBeforeUnmount(() => {
    clearTimeout(refreshTimer)
    clearInterval(tickTimer)
  })

  const count = computed(() => ships.value.length)

  return { enabled, count, snapshotTime, collectingSince, loading, error, unavailable, query, matches, refresh, flyTo }
}
