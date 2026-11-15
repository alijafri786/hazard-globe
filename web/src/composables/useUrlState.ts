import { Cartesian3, Math as CesiumMath, type Entity, type Viewer } from 'cesium'
import { computed, nextTick, onBeforeUnmount, watch, type Ref, type ShallowRef } from 'vue'
import type { LayerRegistry } from '../layers/registry'
import { cameraView, type CameraView } from '../services/camera'
import type { QuakeFeed } from '../types'
import { SATELLITE_GROUPS, type SatelliteGroup } from './useSatelliteLayer'
import { isHistoryDays, type HistoryDays, type useTimeline } from './useTimeline'

export const TABS = ['events', 'weather', 'flights', 'space', 'alerts'] as const
export type Tab = (typeof TABS)[number]

/** What a shared link restores. Watch areas, alerts and searched places are never part of it. */
export interface ViewState {
  /** where the camera is, and whether on the globe (3D), the flat map (2D) or Columbus view */
  cam?: CameraView
  layers?: string[]
  /** a GDACS event (`TC-1001234`) or a USGS earthquake (`usgs-us7000tyek`) to select */
  event?: string
  tab?: Tab
  history?: { days: HistoryDays; day: string }
  /** the USGS feed, when it's not the default past day */
  quakes?: QuakeFeed
  /** which satellite groups are on */
  sats?: SatelliteGroup[]
}

const EVENT_ID = /^((TC|FL|EQ|VO|WF|DR)-\d{1,10}|usgs-[a-z0-9]{1,20})$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
const LAYER_ID = /^[a-z0-9-]{1,30}$/i

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const VIEW_MODES = ['2d', 'cv'] as const

/** Reads a fragment such as `#cam=…&layers=…`. Untrusted: anything malformed is left out, numbers clamped. */
export function parseViewState(hash: string): ViewState {
  const q = new URLSearchParams(hash.replace(/^#/, ''))
  const state: ViewState = {}

  const cam = q.get('cam')?.split(',').map(Number)
  if (cam?.length === 5 && cam.every(Number.isFinite)) {
    const [lon, lat, height, heading, pitch] = cam
    const mode = q.get('mode')
    state.cam = {
      mode: (VIEW_MODES as readonly (string | null)[]).includes(mode) ? (mode as CameraView['mode']) : '3d',
      lon: clamp(lon, -180, 180),
      lat: clamp(lat, -90, 90),
      // in 2D this is the width of the view, up to a few times the world's width
      height: clamp(height, 100, 1e8),
      heading: ((heading % 360) + 360) % 360,
      pitch: clamp(pitch, -90, 0),
    }
  }

  // `layers=` is a view with everything off; a list with nothing usable in it is ignored
  const layers = q.get('layers')
  if (layers === '') state.layers = []
  else if (layers !== null) {
    const ids = layers.split(',').filter((id) => LAYER_ID.test(id)).slice(0, 50)
    if (ids.length) state.layers = ids
  }

  const event = q.get('event')
  if (event && EVENT_ID.test(event)) state.event = event

  const tab = q.get('tab')
  if (tab && (TABS as readonly string[]).includes(tab)) state.tab = tab as Tab

  const quakes = q.get('quakes')
  if (quakes === 'day' || quakes === 'week') state.quakes = quakes

  const sats = q.get('sats')?.split(',').filter((g): g is SatelliteGroup => Object.hasOwn(SATELLITE_GROUPS, g))
  if (sats?.length) state.sats = sats

  const [days, day] = q.get('history')?.split(':') ?? []
  if (days && day && isHistoryDays(Number(days)) && DAY.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
    state.history = { days: Number(days) as HistoryDays, day }
  }
  return state
}

/** One fixed order for ids in a link, whoever's browser makes it, so the same view gives the same link */
const byId = (a: string, b: string) => a.localeCompare(b, 'en')

/** The fragment for a view, in a fixed order, so the same view always gives the same link */
export function formatViewState(s: ViewState): string {
  const q = new URLSearchParams()
  if (s.cam) {
    const { mode, lon, lat, height, heading, pitch } = s.cam
    // Rounded before wrapping, so 359.97° is written 0.0, not 360.0
    const h = (((Math.round(heading * 10) / 10) % 360) + 360) % 360
    q.set('cam', [lon.toFixed(4), lat.toFixed(4), Math.round(height), h.toFixed(1), pitch.toFixed(1)].join(','))
    if (mode !== '3d') q.set('mode', mode)
  }
  if (s.layers) q.set('layers', [...s.layers].sort(byId).join(','))
  if (s.event) q.set('event', s.event)
  if (s.tab) q.set('tab', s.tab)
  if (s.history) q.set('history', `${s.history.days}:${s.history.day}`)
  if (s.quakes) q.set('quakes', s.quakes)
  if (s.sats) q.set('sats', [...s.sats].sort(byId).join(','))
  // commas are safe in a fragment and much easier to read than %2C
  return q.toString().replaceAll('%2C', ',').replaceAll('%3A', ':')
}

const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10)

function findEntity(viewer: Viewer, id: string): Entity | undefined {
  for (let i = 0; i < viewer.dataSources.length; i++) {
    const found = viewer.dataSources.get(i).entities.getById(id)
    if (found) return found
  }
  return undefined
}

/**
 * Keeps the view in the address bar's fragment, so the link can be shared or bookmarked and opens
 * the same view: camera and scene mode (3D, 2D or Columbus view), layers, selected event, tab and
 * History day. Read once on load, then rewritten with replaceState (no history entries for every
 * camera move) when the camera comes to rest or anything else changes.
 */
export function useUrlState({
  viewer,
  layers,
  timeline,
  tab,
  loaded,
  quakeFeed,
  satelliteGroups,
}: {
  viewer: ShallowRef<Viewer | null>
  layers: LayerRegistry
  timeline: ReturnType<typeof useTimeline>
  tab: Ref<Tab>
  /** the USGS feed chosen, which the layer list's switch doesn't say */
  quakeFeed: Ref<QuakeFeed>
  /** which satellite groups are on, which the layer list's one switch doesn't say */
  satelliteGroups: Ref<Record<SatelliteGroup, boolean>>
  /** changes whenever events or quakes arrive, so a linked event can be selected once it exists */
  loaded: Readonly<Ref<unknown>>
}) {
  const initial = parseViewState(location.hash)
  let ready = false
  let pendingEvent = initial.event
  let writeTimer: ReturnType<typeof setTimeout> | undefined
  /**
   * The camera as it last came to rest. Mid-way between 3D and 2D the camera names no real place, so a
   * link made then (Share, Open in Hazard Globe, or the address bar) gives the view before the change.
   */
  let settled: CameraView | undefined

  function current(): ViewState {
    const v = viewer.value
    const state: ViewState = {
      layers: layers.entries.filter((e) => e.on.value).map((e) => e.id),
      tab: tab.value,
    }
    if (v) {
      const cam = cameraView(v) ?? settled
      if (cam) state.cam = cam
      const selected = v.selectedEntity?.id
      if (selected && EVENT_ID.test(selected)) state.event = selected
    }
    if (timeline.mode.value === 'history') state.history = { days: timeline.days.value, day: isoDay(timeline.day.value) }
    const on = (id: string) => layers.entries.some((e) => e.id === id && e.on.value)
    if (on('usgs-quakes') && quakeFeed.value !== 'day') state.quakes = quakeFeed.value
    const sats = (Object.keys(SATELLITE_GROUPS) as SatelliteGroup[]).filter((g) => satelliteGroups.value[g])
    if (sats.length) state.sats = sats
    return state
  }

  /** The link to this view now */
  function link(): string {
    return `${location.origin}${location.pathname}${location.search}#${formatViewState(current())}`
  }

  function write() {
    clearTimeout(writeTimer)
    if (!ready) return
    history.replaceState(history.state, '', `${location.pathname}${location.search}#${formatViewState(current())}`)
  }
  const scheduleWrite = () => {
    clearTimeout(writeTimer)
    writeTimer = setTimeout(write, 400)
  }
  /** The camera has come to rest: after a move, or once a change between 3D and 2D is over */
  function onSettled() {
    const v = viewer.value
    settled = (v && cameraView(v)) || settled
    scheduleWrite()
  }

  function trySelect() {
    const v = viewer.value
    if (!v || !pendingEvent) return
    const entity = findEntity(v, pendingEvent)
    if (!entity) return
    pendingEvent = undefined
    v.selectedEntity = entity
  }

  async function apply(v: Viewer) {
    // The feed before the layer goes on, so it loads the linked feed and not the default first
    if (initial.quakes) quakeFeed.value = initial.quakes
    // Only a list naming at least one real layer (or none at all, deliberately) changes what's on
    const known = initial.layers?.filter((id) => layers.entries.some((e) => e.id === id))
    if (initial.layers && (known!.length || !initial.layers.length)) {
      const on = new Set(known)
      for (const e of layers.entries) {
        // Named groups are set below, exactly: the switch would turn its default groups on first
        if (e.id === 'satellites' && initial.sats) continue
        e.on.value = on.has(e.id)
      }
    }
    if (initial.sats) {
      satelliteGroups.value = Object.fromEntries(
        (Object.keys(SATELLITE_GROUPS) as SatelliteGroup[]).map((g) => [g, initial.sats!.includes(g)]),
      ) as Record<SatelliteGroup, boolean>
    }
    if (initial.tab) tab.value = initial.tab
    if (initial.history) {
      timeline.days.value = initial.history.days
      timeline.mode.value = 'history'
      await nextTick() // the mode change moves to today first
      const at = timeline.dayList.value.findIndex((d) => isoDay(d) === initial.history!.day)
      if (at >= 0) timeline.index.value = at
    }
    if (initial.cam) {
      const { mode, lon, lat, height, heading, pitch } = initial.cam
      // Into the linked mode first, at once: in 2D the height is the width of the view, read as such by setView
      if (mode === '2d') v.scene.morphTo2D(0)
      else if (mode === 'cv') v.scene.morphToColumbusView(0)
      v.camera.setView({
        destination: Cartesian3.fromDegrees(lon, lat, height),
        orientation: { heading: CesiumMath.toRadians(heading), pitch: CesiumMath.toRadians(pitch), roll: 0 },
      })
    }
    trySelect()
    settled = cameraView(v)
    ready = true
  }

  let removeCameraListener: (() => void) | undefined
  let removeMorphListener: (() => void) | undefined
  let removeSelectionListener: (() => void) | undefined
  watch(
    viewer,
    (v) => {
      if (!v) return
      void apply(v)
      removeCameraListener = v.camera.moveEnd.addEventListener(onSettled)
      // One write when a change between 3D and 2D is over, rather than polling through it
      removeMorphListener = v.scene.morphComplete.addEventListener(onSettled)
      removeSelectionListener = v.selectedEntityChanged.addEventListener(scheduleWrite)
    },
    { immediate: true },
  )

  const layerState = computed(() => layers.entries.map((e) => e.on.value).join())
  watch([layerState, tab, timeline.mode, timeline.days, timeline.index, quakeFeed], scheduleWrite)
  watch(satelliteGroups, scheduleWrite, { deep: true })
  // A linked event can only be selected once it has loaded
  watch(loaded, () => pendingEvent && trySelect())

  onBeforeUnmount(() => {
    clearTimeout(writeTimer)
    removeCameraListener?.()
    removeMorphListener?.()
    removeSelectionListener?.()
  })

  return { link, flush: write, initial }
}
