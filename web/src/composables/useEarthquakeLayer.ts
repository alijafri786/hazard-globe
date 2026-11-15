import {
  Cartesian3,
  Color,
  ConstantPositionProperty,
  ConstantProperty,
  CustomDataSource,
  Entity,
  HeightReference,
  NearFarScalar,
  type Viewer,
} from 'cesium'
import { onBeforeUnmount, ref, shallowRef, watch, type Ref, type ShallowRef } from 'vue'
import { api } from '../services/api'
import { escapeHtml } from '../services/html'
import type { HazardEvent, Quake, QuakeFeed } from '../types'
import type { useTimeline } from './useTimeline'

export const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/map/'

export const QUAKE_FEEDS: Record<QuakeFeed, { label: string; windowMs: number }> = {
  day: { label: 'Past day, magnitude 2.5+', windowMs: 86_400_000 },
  week: { label: 'Past week, magnitude 4.5+', windowMs: 7 * 86_400_000 },
}

/** Colour by depth, as USGS's own maps do: shallow quakes do the most damage */
export const DEPTH_BANDS = [
  { upToKm: 70, colour: '#f4511e', label: 'Shallow, under 70 km' },
  { upToKm: 300, colour: '#fdd835', label: '70–300 km' },
  { upToKm: Infinity, colour: '#42a5f5', label: 'Deep, over 300 km' },
] as const

const REFRESH_MS = 2 * 60_000 // the server asks USGS at most every 2 minutes
const PAGER_WORDS = { green: 'Green', yellow: 'Yellow', orange: 'Orange', red: 'Red' } as const

const depthColour = (km: number) => DEPTH_BANDS.find((b) => km < b.upToKm)!.colour
/** About 4 px at M2.5, 22 px at M8.5: each step of magnitude is ~32 times the energy, so size grows with it */
export const quakeSize = (mag: number) => Math.round(Math.min(22, Math.max(4, 4 + (mag - 2.5) * 3)))

const utc = (s: string) => Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(s) ? s : `${s}Z`)

/** Great-circle distance in km */
function km(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const rad = Math.PI / 180
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

/** The GDACS earthquake that is this quake: within 50 km and 2 minutes of it */
export function matchGdacs(q: Quake, events: readonly HazardEvent[]): HazardEvent | undefined {
  return events.find((e) => {
    if (e.properties.eventtype !== 'EQ' || e.geometry?.type !== 'Point') return false
    const [lon, lat] = e.geometry.coordinates as number[]
    const at = e.properties.fromdate ? utc(e.properties.fromdate) : NaN
    return Math.abs(at - q.time) <= 2 * 60_000 && km(q, { lon, lat }) <= 50
  })
}

function describe(q: Quake, gdacs: HazardEvent | undefined): string {
  const when = new Date(q.time).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
  const rows = [
    ['Magnitude', q.mag.toFixed(1)],
    ['Depth', `${Math.round(q.depthKm)} km`],
    ['Time', `${when} UTC`],
    ['Where', q.place],
    ['USGS PAGER', q.alert ? `${PAGER_WORDS[q.alert]} (estimated impact)` : ''],
    ['GDACS alert', gdacs?.properties.alertlevel ?? ''],
  ].filter(([, v]) => v)
  const table = rows.map(([k, v]) => `<tr><th>${k}</th><td>${escapeHtml(v)}</td></tr>`).join('')
  const tsunami = q.tsunami
    ? `<p style="font-size:13px">A large earthquake under the sea. USGS flags these, but the flag doesn't mean a
       tsunami happened: check <a href="https://www.tsunami.gov" target="_blank" rel="noopener">tsunami.gov</a>
       and your local warnings.</p>`
    : ''
  const links = [
    q.url ? `<a href="${escapeHtml(q.url)}" target="_blank" rel="noopener">USGS event page ↗</a>` : '',
    gdacs?.properties.url?.report
      ? `<a href="${escapeHtml(gdacs.properties.url.report)}" target="_blank" rel="noopener">GDACS report ↗</a>`
      : '',
  ].filter(Boolean)
  return `<table class="cesium-infoBox-defaultTable">${table}</table>${tsunami}
    ${links.length ? `<p>${links.join(' · ')}</p>` : ''}
    <p style="opacity:.7;font-size:12px">Source: USGS (public domain). Not an official warning.</p>`
}

/**
 * Earthquakes from the USGS real-time feeds, through the server: sized by magnitude, coloured by depth,
 * fading with age. Live only, so hidden in History mode. Joined to the GDACS earthquake that is the same
 * event, when there is one, so the card can give both.
 */
export function useEarthquakeLayer(
  viewer: ShallowRef<Viewer | null>,
  timeline: ReturnType<typeof useTimeline>,
  gdacsEvents: Readonly<Ref<readonly HazardEvent[]>>,
) {
  const enabled = ref(false)
  const feed = ref<QuakeFeed>('day')
  const quakes = shallowRef<Quake[]>([])
  const generatedAt = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const source = new CustomDataSource('usgs-quakes')
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  let latestRequest = 0

  /**
   * Updates the markers in place, by quake id: a quake still in the feed keeps its entity, so one that's
   * selected keeps its card open (and a selection from a shared link survives) through each refresh.
   */
  function render() {
    const window = QUAKE_FEEDS[feed.value].windowMs
    const events = gdacsEvents.value
    const ids = new Set(quakes.value.map((q) => `usgs-${q.id}`))
    const entities = source.entities
    entities.suspendEvents()
    for (const e of [...entities.values]) if (!ids.has(e.id)) entities.remove(e)
    // Biggest last, so new ones draw on top (those already there keep their place)
    for (const q of [...quakes.value].sort((a, b) => a.mag - b.mag)) {
      const id = `usgs-${q.id}`
      const age = Math.min(1, Math.max(0, (Date.now() - q.time) / window))
      // newest bright, a full feed's age down to a third
      const colour = Color.fromCssColorString(depthColour(q.depthKm)).withAlpha(1 - 0.65 * age)
      const name = `M ${q.mag.toFixed(1)} — ${q.place || 'Earthquake'}`
      const description = describe(q, matchGdacs(q, events))
      const existing = entities.getById(id)
      if (existing) {
        // USGS revises magnitude, place and position as a quake is reviewed
        existing.name = name
        existing.position = new ConstantPositionProperty(Cartesian3.fromDegrees(q.lon, q.lat))
        existing.description = description
        existing.point!.color = new ConstantProperty(colour)
        existing.point!.pixelSize = new ConstantProperty(quakeSize(q.mag))
        continue
      }
      entities.add(
        new Entity({
          id,
          name,
          position: Cartesian3.fromDegrees(q.lon, q.lat),
          description,
          point: {
            pixelSize: quakeSize(q.mag),
            color: colour,
            outlineColor: Color.BLACK.withAlpha(0.6),
            outlineWidth: 1,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            scaleByDistance: new NearFarScalar(1e6, 1.3, 2e7, 0.8),
          },
        }),
      )
    }
    entities.resumeEvents()
    show()
  }

  function show() {
    source.show = enabled.value && timeline.mode.value === 'live'
    viewer.value?.scene.requestRender()
  }

  async function load() {
    clearTimeout(refreshTimer)
    if (!enabled.value) return
    const request = ++latestRequest
    loading.value = true
    error.value = null
    try {
      const res = await api.earthquakes(feed.value)
      if (request !== latestRequest || !enabled.value) return
      quakes.value = res.quakes
      generatedAt.value = res.generatedAt ?? res.fetchedAt
      render()
    } catch (err) {
      if (request === latestRequest) error.value = (err as Error).message
    } finally {
      if (request === latestRequest) {
        loading.value = false
        if (enabled.value) refreshTimer = setTimeout(() => void load(), REFRESH_MS)
      }
    }
  }

  watch(
    viewer,
    (v) => {
      if (v) void v.dataSources.add(source)
    },
    { immediate: true },
  )

  // One watcher for both, so a shared link setting the feed and switching on loads once, not twice
  watch([enabled, feed], ([on, f], [, wasFeed]) => {
    if (f !== wasFeed) {
      quakes.value = [] // another feed's quakes don't belong
      render()
    }
    // Shown (or hidden) at once: quakes already loaded stay usable while a refresh runs, or if it fails
    show()
    if (on) void load()
    else clearTimeout(refreshTimer)
  })
  watch(timeline.mode, show)
  // GDACS events can arrive after the quakes: draw again so the cards can name their GDACS alert
  watch(gdacsEvents, () => quakes.value.length && render())

  onBeforeUnmount(() => {
    enabled.value = false
    clearTimeout(refreshTimer)
    viewer.value?.dataSources.remove(source, true)
  })

  return { enabled, feed, quakes, generatedAt, loading, error }
}
