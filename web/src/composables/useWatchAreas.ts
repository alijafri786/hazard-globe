import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  DistanceDisplayCondition,
  LabelStyle,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  type Entity,
  type Viewer,
} from 'cesium'
import { onBeforeUnmount, ref, toRaw, watch, type ShallowRef } from 'vue'
import { api, ApiError } from '../services/api'
import type { ChannelView, DraftArea, ServerChannels, SubscriptionView, WatchArea } from '../types'

const STORAGE_KEY = 'hazard-globe:watch-areas'
/** Earlier versions saved a single area here */
const LEGACY_KEY = 'hazard-globe:watch'
const DEFAULTS = { radiusKm: 150, hazards: ['TC', 'FL'], minAlert: 'Orange' } as const
const SAVED_COLOUR = Color.fromCssColorString('#7c5cff')
const DRAFT_COLOUR = Color.WHITE

interface Saved {
  areas: WatchArea[]
  subscriptionId?: string
}

function readSaved(): Saved {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Saved
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const { area, subscriptionId } = JSON.parse(legacy) as { area?: Omit<WatchArea, 'hazards' | 'minAlert'>; subscriptionId?: string }
      // The browser never saved hazards or level; the server's copy replaces these on the first sync
      return { areas: area ? [{ ...area, hazards: [...DEFAULTS.hazards], minAlert: DEFAULTS.minAlert }] : [], subscriptionId }
    }
  } catch {
    /* unreadable: start fresh */
  }
  return { areas: [] }
}

const hasCentre = (d: DraftArea): d is WatchArea => Number.isFinite(d.lon) && Number.isFinite(d.lat)

/** The places the user wants alerts for, each picked on the globe or from device location. */
export function useWatchAreas(viewer: ShallowRef<Viewer | null>) {
  const saved = readSaved()
  const areas = ref<WatchArea[]>(saved.areas)
  const subscriptionId = ref<string | undefined>(saved.subscriptionId)
  /** The area being added (editingIndex null) or edited */
  const draft = ref<DraftArea | null>(null)
  const editingIndex = ref<number | null>(null)
  const picking = ref(false)
  /** The server no longer knows our subscription (expired or removed elsewhere) */
  const expired = ref(false)
  /** How the server can reach us, as it last told us */
  const channels = ref<ChannelView[]>([])
  /** What the server offers; null until known or if it can't be reached */
  const serverChannels = ref<ServerChannels | null>(null)

  let handler: ScreenSpaceEventHandler | null = null
  let drawn: Entity[] = []

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ areas: areas.value, subscriptionId: subscriptionId.value }))
      localStorage.removeItem(LEGACY_KEY)
    } catch {
      /* private mode etc. — the app still works for this session */
    }
  }

  function drawArea(v: Viewer, a: WatchArea, colour: Color) {
    const radiusM = a.radiusKm * 1000
    return v.entities.add({
      name: `Watching: ${a.label}`,
      position: Cartesian3.fromDegrees(a.lon, a.lat),
      ellipse: {
        semiMajorAxis: radiusM,
        semiMinorAxis: radiusM,
        material: colour.withAlpha(0.15),
        outline: true,
        outlineColor: colour,
        height: 0,
      },
      point: { pixelSize: 6, color: colour },
      label: {
        text: a.label,
        font: '12px system-ui, sans-serif',
        style: LabelStyle.FILL_AND_OUTLINE,
        outlineWidth: 3,
        outlineColor: Color.BLACK,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -10),
        distanceDisplayCondition: new DistanceDisplayCondition(0, Math.max(4e6, radiusM * 20)),
      },
    })
  }

  function draw() {
    const v = viewer.value
    if (!v) return
    for (const e of drawn) v.entities.remove(e)
    drawn = areas.value
      .filter((_, i) => !(draft.value && editingIndex.value === i)) // the draft stands in for it
      .map((a) => drawArea(v, a, SAVED_COLOUR))
    if (draft.value && hasCentre(draft.value)) drawn.push(drawArea(v, draft.value, DRAFT_COLOUR))
    v.scene.requestRender()
  }

  function startAdd() {
    stopPicking()
    editingIndex.value = null
    draft.value = {
      label: areas.value.length ? `Area ${areas.value.length + 1}` : 'My area',
      radiusKm: DEFAULTS.radiusKm,
      hazards: [...DEFAULTS.hazards],
      minAlert: DEFAULTS.minAlert,
      forecastAlerts: false,
    }
  }

  function startEdit(i: number) {
    stopPicking()
    editingIndex.value = i
    draft.value = structuredClone(toRaw(areas.value[i]))
  }

  function cancelEdit() {
    stopPicking()
    draft.value = null
    editingIndex.value = null
  }

  /** The list as it would be with the draft saved, or null while the draft has no centre. */
  function withDraft(): WatchArea[] | null {
    const d = draft.value
    if (!d || !hasCentre(d)) return null
    const next = areas.value.map((a) => structuredClone(toRaw(a)))
    const area = { ...structuredClone(toRaw(d)), label: d.label.trim() || 'My area' }
    if (editingIndex.value === null) next.push(area)
    else next[editingIndex.value] = area
    return next
  }

  const without = (i: number): WatchArea[] => areas.value.filter((_, j) => j !== i)

  function setCentre(lon: number, lat: number) {
    if (!draft.value) return
    draft.value.lon = Number(lon.toFixed(4))
    draft.value.lat = Number(lat.toFixed(4))
  }

  function startPicking() {
    const v = viewer.value
    if (!v || !draft.value) return
    picking.value = true
    handler?.destroy()
    handler = new ScreenSpaceEventHandler(v.scene.canvas)
    handler.setInputAction((click: ScreenSpaceEventHandler.PositionedEvent) => {
      const cartesian = v.camera.pickEllipsoid(click.position, v.scene.globe.ellipsoid)
      if (!cartesian) return
      const c = Cartographic.fromCartesian(cartesian)
      setCentre(CesiumMath.toDegrees(c.longitude), CesiumMath.toDegrees(c.latitude))
      stopPicking()
    }, ScreenSpaceEventType.LEFT_CLICK)
  }

  function stopPicking() {
    picking.value = false
    handler?.destroy()
    handler = null
  }

  function useDeviceLocation(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) return reject(new Error('Location is not available on this device.'))
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setCentre(pos.coords.longitude, pos.coords.latitude)
          resolve()
        },
        () => reject(new Error('Location permission was denied.')),
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
      )
    })
  }

  function flyTo(a: DraftArea) {
    const v = viewer.value
    if (!v || !hasCentre(a)) return
    v.camera.flyTo({ destination: Cartesian3.fromDegrees(a.lon, a.lat, a.radiusKm * 1000 * 6), duration: 1.4 })
  }

  /** Take on what the server says: it assigns ids and is the source of truth. */
  function applyView(view: SubscriptionView) {
    subscriptionId.value = view.id
    areas.value = view.areas
    channels.value = view.channels
    expired.value = false
  }

  function forget() {
    subscriptionId.value = undefined
    channels.value = []
    areas.value = areas.value.map(({ id: _, ...a }) => a) // server ids mean nothing once it has forgotten us
  }

  async function refresh() {
    if (!subscriptionId.value) return
    try {
      applyView(await api.subscription(subscriptionId.value))
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        forget()
        expired.value = true
      } // otherwise offline or server down: keep what we have
    }
  }

  // Coming back from confirming an email or linking Telegram in another tab or app
  const onVisible = () => document.visibilityState === 'visible' && void refresh()

  watch([areas, draft, editingIndex], draw, { deep: true })
  watch([areas, subscriptionId], persist, { deep: true })
  watch(viewer, (v) => v && draw(), { immediate: true })
  document.addEventListener('visibilitychange', onVisible)
  onBeforeUnmount(() => {
    handler?.destroy()
    document.removeEventListener('visibilitychange', onVisible)
  })
  void refresh()
  api.channels().then((c) => (serverChannels.value = c), () => undefined)

  return {
    areas,
    subscriptionId,
    draft,
    editingIndex,
    picking,
    expired,
    channels,
    serverChannels,
    applyView,
    forget,
    refresh,
    startAdd,
    startEdit,
    cancelEdit,
    withDraft,
    without,
    startPicking,
    stopPicking,
    useDeviceLocation,
    flyTo,
  }
}
