import { Cartesian3, Color, CustomDataSource, Entity, HeightReference, NearFarScalar, type Viewer } from 'cesium'
import { computed, onBeforeUnmount, ref, shallowRef, watch, type ShallowRef } from 'vue'
import { api } from '../services/api'
import { escapeHtml } from '../services/html'
import type { DartReadings, DartStation, TsunamiMessage, TsunamiMessageType } from '../types'
import type { useTimeline } from './useTimeline'

export const TSUNAMI_URL = 'https://www.tsunami.gov/'

/** What each kind of message looks like: the alert colours for danger, quiet grey for information */
export const MESSAGE_STYLE: Record<TsunamiMessageType, { colour: string; label: string }> = {
  warning: { colour: '#e5484d', label: 'Warning' },
  threat: { colour: '#e5484d', label: 'Threat' },
  advisory: { colour: '#f5a524', label: 'Advisory' },
  watch: { colour: '#f5a524', label: 'Watch' },
  information: { colour: '#94a0b8', label: 'Information' },
  cancellation: { colour: '#46a758', label: 'Cancelled' },
}

export const DART_COLOUR = '#3987e5'

const REFRESH_MS = 2 * 60_000 // the server reads the centres' feeds every 2 minutes
const ACTIVE_MS = 12 * 3_600_000

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) +
  ' UTC'

function describeMessage(m: TsunamiMessage): string {
  const rows = [
    ['Message', MESSAGE_STYLE[m.type].label],
    ['From', m.centre === 'PTWC' ? 'Pacific Tsunami Warning Center' : 'National Tsunami Warning Center'],
    ['Earthquake', m.magnitude ? `Magnitude ${m.magnitude}` : ''],
    ['Issued', when(m.issuedAt)],
  ].filter(([, v]) => v)
  const table = rows.map(([k, v]) => `<tr><th>${k}</th><td>${escapeHtml(v)}</td></tr>`).join('')
  return `<table class="cesium-infoBox-defaultTable">${table}</table>
    <p><a href="${escapeHtml(m.url)}" target="_blank" rel="noopener">Read the bulletin ↗</a></p>
    <p style="opacity:.7;font-size:12px">From NOAA's tsunami warning centres, which cover the Pacific, the Caribbean and North
    American coasts. Not an official warning: follow your local authorities.</p>`
}

/** The last day's water height as a line, in cm against its mean: a tsunami shows as a sudden swing */
export function dartChart(r: DartReadings): string {
  if (r.readings.length < 2) return '<p>No readings in the last day.</p>'
  const mean = r.readings.reduce((s, x) => s + x.heightM, 0) / r.readings.length
  const cm = r.readings.map((x) => (x.heightM - mean) * 100)
  const t0 = Date.parse(r.readings[0].time)
  const t1 = Date.parse(r.readings.at(-1)!.time)
  const lo = Math.min(...cm)
  const hi = Math.max(...cm)
  const W = 280
  const H = 90
  const P = { l: 34, r: 6, t: 8, b: 16 }
  const x = (t: number) => P.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - P.l - P.r)
  const y = (v: number) => P.t + (1 - (v - lo) / Math.max(1e-6, hi - lo)) * (H - P.t - P.b)
  const points = r.readings.map((rd, i) => `${x(Date.parse(rd.time)).toFixed(1)},${y(cm[i]).toFixed(1)}`).join(' ')
  const fmt = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} cm`
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Water height over the last day, ${fmt(lo)} to ${fmt(hi)} about its average">
    <line x1="${P.l}" x2="${W - P.r}" y1="${y(hi)}" y2="${y(hi)}" stroke="rgba(128,128,128,.25)" stroke-width="1"/>
    <line x1="${P.l}" x2="${W - P.r}" y1="${y(lo)}" y2="${y(lo)}" stroke="rgba(128,128,128,.25)" stroke-width="1"/>
    <text x="${P.l - 4}" y="${y(hi) + 3}" text-anchor="end" font-size="9" fill="currentColor">${fmt(hi)}</text>
    <text x="${P.l - 4}" y="${y(lo) + 3}" text-anchor="end" font-size="9" fill="currentColor">${fmt(lo)}</text>
    <polyline points="${points}" fill="none" stroke="${DART_COLOUR}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <text x="${P.l}" y="${H - 3}" font-size="9" fill="currentColor">24 h ago</text>
    <text x="${W - P.r}" y="${H - 3}" text-anchor="end" font-size="9" fill="currentColor">now</text>
  </svg>`
}

function describeBuoy(s: DartStation, r: DartReadings | null): string {
  const mode = r?.eventMode
    ? '<p><strong>In event mode:</strong> reporting every minute or faster, as it does when it senses a wave.</p>'
    : ''
  const chart = r ? dartChart(r) : '<p>Loading the last day…</p>'
  return `<p>${escapeHtml(s.name)}</p>${mode}
    <p style="margin-bottom:2px">Water above the buoy, against its average (the tide shows as a slow swing)</p>${chart}
    <p style="opacity:.7;font-size:12px">A NOAA DART buoy on the deep-ocean floor. Source: NOAA National Data Buoy Center.</p>`
}

/**
 * Tsunami messages from NOAA's two warning centres, and the DART buoys that watch the deep ocean for one.
 * The messages are fetched whenever live, layer on or not, so a warning in force can always be shown; rings
 * and buoys are drawn only when switched on. Live only.
 */
export function useTsunamiLayer(viewer: ShallowRef<Viewer | null>, timeline: ReturnType<typeof useTimeline>) {
  const enabled = ref(false)
  const buoysOn = ref(false)
  const messages = shallowRef<TsunamiMessage[]>([])
  const error = ref<string | null>(null)

  const rings = new CustomDataSource('tsunami-messages')
  const buoys = new CustomDataSource('dart-buoys')
  let timer: ReturnType<typeof setInterval> | undefined
  let stations: DartStation[] | null = null

  const live = () => timeline.mode.value === 'live'

  /** Warnings and threats in force: the newest message about their earthquake, from the last 12 hours */
  const active = computed(() => {
    const newest = new Map<string, TsunamiMessage>()
    for (const m of messages.value) if (!newest.has(m.event)) newest.set(m.event, m) // newest first
    return [...newest.values()].filter(
      (m) => (m.type === 'warning' || m.type === 'threat') && Date.now() - Date.parse(m.issuedAt) < ACTIVE_MS,
    )
  })

  function drawRings() {
    rings.entities.removeAll()
    for (const m of messages.value) {
      const style = MESSAGE_STYLE[m.type]
      rings.entities.add(
        new Entity({
          id: `tsunami-${m.id}`,
          name: `Tsunami ${style.label.toLowerCase()}: ${m.region}`,
          position: Cartesian3.fromDegrees(m.lon, m.lat),
          description: describeMessage(m),
          point: {
            pixelSize: 18,
            color: Color.TRANSPARENT,
            outlineColor: Color.fromCssColorString(style.colour),
            outlineWidth: 3,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            scaleByDistance: new NearFarScalar(1e6, 1.3, 2e7, 0.8),
          },
        }),
      )
    }
    show()
  }

  async function drawBuoys() {
    if (!buoysOn.value || !live()) return show()
    try {
      stations ??= (await api.dartStations()).stations
    } catch (err) {
      error.value = (err as Error).message
      return
    }
    if (!buoys.entities.values.length) {
      for (const s of stations) {
        buoys.entities.add(
          new Entity({
            id: `dart-${s.id}`,
            name: `DART buoy ${s.id}`,
            position: Cartesian3.fromDegrees(s.lon, s.lat),
            description: describeBuoy(s, null),
            point: {
              pixelSize: 7,
              color: Color.fromCssColorString(DART_COLOUR),
              outlineColor: Color.WHITE,
              outlineWidth: 1,
              heightReference: HeightReference.CLAMP_TO_GROUND,
            },
            properties: { dart: s },
          }),
        )
      }
    }
    show()
  }

  function show() {
    rings.show = enabled.value && live()
    buoys.show = buoysOn.value && live()
    viewer.value?.scene.requestRender()
  }

  async function load() {
    if (!live()) return
    try {
      messages.value = (await api.tsunami()).messages
      error.value = null
      drawRings()
    } catch (err) {
      error.value = (err as Error).message
    }
  }

  // A buoy's card fills in with its last day once opened
  async function showBuoy(entity: Entity) {
    const s = entity.properties?.dart?.getValue() as DartStation | undefined
    if (!s) return
    const r = await api.dartReadings(s.id).catch(() => null)
    if (viewer.value?.selectedEntity !== entity) return
    entity.description = r ? describeBuoy(s, r) : `<p>${escapeHtml(s.name)}</p><p>No readings available now.</p>`
    viewer.value?.scene.requestRender()
  }

  watch(
    viewer,
    (v) => {
      if (!v) return
      void v.dataSources.add(rings)
      void v.dataSources.add(buoys)
      v.selectedEntityChanged.addEventListener((e?: Entity) => e && buoys.entities.contains(e) && void showBuoy(e))
    },
    { immediate: true },
  )
  watch([enabled, timeline.mode], show)
  watch([buoysOn, timeline.mode], () => void drawBuoys())
  watch(
    timeline.mode,
    (mode) => {
      clearInterval(timer)
      if (mode !== 'live') return
      void load()
      timer = setInterval(() => void load(), REFRESH_MS)
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    clearInterval(timer)
    viewer.value?.dataSources.remove(rings, true)
    viewer.value?.dataSources.remove(buoys, true)
  })

  return { enabled, buoysOn, messages, active, error }
}
