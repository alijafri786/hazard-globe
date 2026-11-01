import {
  Cartesian3,
  Cartographic,
  Color,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Entity,
  type Viewer,
} from 'cesium'
import { onBeforeUnmount, ref, watch, type ShallowRef } from 'vue'
import type { WatchArea } from '../types'

const STORAGE_KEY = 'hazard-globe:watch'

interface Saved {
  area: WatchArea
  subscriptionId?: string
}

function readSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Saved) : null
  } catch {
    return null
  }
}

/** The single place the user wants alerts for: picked on the globe or from device location. */
export function useWatchArea(viewer: ShallowRef<Viewer | null>) {
  const saved = readSaved()
  const area = ref<WatchArea | null>(saved?.area ?? null)
  const subscriptionId = ref<string | undefined>(saved?.subscriptionId)
  const picking = ref(false)

  let handler: ScreenSpaceEventHandler | null = null
  let circle: Entity | null = null

  function persist() {
    try {
      if (area.value) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ area: area.value, subscriptionId: subscriptionId.value }))
      } else {
        localStorage.removeItem(STORAGE_KEY)
      }
    } catch {
      /* private mode etc. — the app still works for this session */
    }
  }

  function draw() {
    const v = viewer.value
    if (!v) return
    if (circle) v.entities.remove(circle)
    circle = null
    if (!area.value) return v.scene.requestRender()
    const { lon, lat, radiusKm, label } = area.value
    const radiusM = radiusKm * 1000
    circle = v.entities.add({
      name: `Watching: ${label}`,
      position: Cartesian3.fromDegrees(lon, lat),
      ellipse: {
        semiMajorAxis: radiusM,
        semiMinorAxis: radiusM,
        material: Color.fromCssColorString('#7c5cff').withAlpha(0.15),
        outline: true,
        outlineColor: Color.fromCssColorString('#7c5cff'),
        height: 0,
      },
      point: { pixelSize: 6, color: Color.fromCssColorString('#7c5cff') },
    })
    v.scene.requestRender()
  }

  function setCentre(lon: number, lat: number) {
    area.value = {
      label: area.value?.label ?? 'My area',
      radiusKm: area.value?.radiusKm ?? 150,
      lon: Number(lon.toFixed(4)),
      lat: Number(lat.toFixed(4)),
    }
  }

  function startPicking() {
    const v = viewer.value
    if (!v) return
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

  function flyToArea() {
    const v = viewer.value
    if (!v || !area.value) return
    const { lon, lat, radiusKm } = area.value
    v.camera.flyTo({ destination: Cartesian3.fromDegrees(lon, lat, radiusKm * 1000 * 6), duration: 1.4 })
  }

  function clear() {
    area.value = null
    subscriptionId.value = undefined
  }

  watch(area, () => (draw(), persist()), { deep: true })
  watch(subscriptionId, persist)
  watch(viewer, (v) => v && draw(), { immediate: true })
  onBeforeUnmount(() => handler?.destroy())

  return { area, subscriptionId, picking, startPicking, stopPicking, useDeviceLocation, flyToArea, clear }
}
