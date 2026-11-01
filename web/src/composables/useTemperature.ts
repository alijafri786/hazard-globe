import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  Credit,
  CustomDataSource,
  HorizontalOrigin,
  LabelStyle,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  type Viewer,
} from 'cesium'
import { onBeforeUnmount, ref, shallowRef, watch, type ShallowRef } from 'vue'
import { escapeHtml } from '../services/html'
import { currentConditions, OPEN_METEO_URL, type Conditions } from '../services/openMeteo'
import type { useTimeline } from './useTimeline'

const UNIT_KEY = 'hazard-globe:temperature-unit'
export type TemperatureUnit = 'C' | 'F'

export const formatTemperature = (celsius: number, unit: TemperatureUnit) =>
  `${Math.round(unit === 'C' ? celsius : (celsius * 9) / 5 + 32)} °${unit}`

export const formatWind = (kmh: number, unit: TemperatureUnit) =>
  unit === 'C' ? `${Math.round(kmh)} km/h` : `${Math.round(kmh / 1.609344)} mph`

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
export const compassPoint = (deg: number) => COMPASS[Math.round(deg / 45) % 8]

/** The place's own clock, from the UTC offset Open-Meteo gives for it */
export const localTime = (c: Conditions) =>
  new Date(Date.now() + c.utcOffsetSeconds * 1000).toLocaleTimeString('en-GB', { timeStyle: 'short', timeZone: 'UTC' })

function readUnit(): TemperatureUnit {
  try {
    return localStorage.getItem(UNIT_KEY) === 'F' ? 'F' : 'C'
  } catch {
    return 'C'
  }
}

export interface Spot {
  lon: number
  lat: number
  /** Set when the spot came from search */
  name?: string
}

const LABEL_BACKGROUND = Color.fromCssColorString('#0d1424').withAlpha(0.85)

/** The temperature, and current conditions, wherever someone picks on the globe, searches for, or is. */
export function useTemperature(viewer: ShallowRef<Viewer | null>, timeline: ReturnType<typeof useTimeline>) {
  const unit = ref<TemperatureUnit>(readUnit())
  const spot = shallowRef<Spot | null>(null)
  const reading = shallowRef<Conditions | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const picking = ref(false)

  const marker = new CustomDataSource('temperature')
  const credit = new Credit(
    `Weather data by <a href="${OPEN_METEO_URL}" target="_blank" rel="noopener">Open-Meteo.com</a>`,
    true,
  )
  let creditShown = false
  let handler: ScreenSpaceEventHandler | null = null
  let latestRequest = 0

  /** Puts the marker, and its credit, in line with the reading. Hidden in History mode: it is today's weather. */
  function draw() {
    const v = viewer.value
    if (!v) return
    marker.entities.removeAll()
    const s = spot.value
    const r = reading.value
    const show = Boolean(s && r && timeline.mode.value === 'live')
    if (show && s && r) {
      const temperature = formatTemperature(r.temperatureC, unit.value)
      marker.entities.add({
        name: `${temperature} · ${r.conditions}`,
        position: Cartesian3.fromDegrees(s.lon, s.lat),
        point: {
          pixelSize: 8,
          color: Color.WHITE,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: temperature,
          font: '600 14px system-ui, sans-serif',
          style: LabelStyle.FILL,
          showBackground: true,
          backgroundColor: LABEL_BACKGROUND,
          horizontalOrigin: HorizontalOrigin.LEFT,
          verticalOrigin: VerticalOrigin.CENTER,
          pixelOffset: new Cartesian2(10, 0),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        description: `<p>Feels like ${formatTemperature(r.feelsLikeC, unit.value)}, humidity ${r.humidityPct}%, wind ${formatWind(
          r.windKmh,
          unit.value,
        )} from the ${compassPoint(r.windFromDeg)}.</p>
          <p style="opacity:.7;font-size:12px">Local time ${escapeHtml(localTime(r))}. Weather data by Open-Meteo.com.</p>`,
      })
    }
    if (show !== creditShown) {
      if (show) v.creditDisplay.addStaticCredit(credit)
      else v.creditDisplay.removeStaticCredit(credit)
      creditShown = show
    }
    v.scene.requestRender()
  }

  async function check(lon: number, lat: number, name?: string) {
    stopPicking()
    spot.value = { lon, lat, name }
    reading.value = null
    const request = ++latestRequest
    loading.value = true
    error.value = null
    draw()
    try {
      const conditions = await currentConditions(lon, lat)
      if (request !== latestRequest) return // asked about somewhere else meanwhile
      reading.value = conditions
    } catch (err) {
      if (request === latestRequest) error.value = (err as Error).message
    } finally {
      if (request === latestRequest) {
        loading.value = false
        draw()
      }
    }
  }

  function clear() {
    latestRequest++
    spot.value = null
    reading.value = null
    loading.value = false
    error.value = null
    draw()
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
      void check(CesiumMath.toDegrees(c.longitude), CesiumMath.toDegrees(c.latitude))
    }, ScreenSpaceEventType.LEFT_CLICK)
  }

  function stopPicking() {
    picking.value = false
    handler?.destroy()
    handler = null
  }

  function checkMyLocation(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) return reject(new Error('Location is not available on this device.'))
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          void check(pos.coords.longitude, pos.coords.latitude)
          resolve()
        },
        () => reject(new Error('Location permission was denied.')),
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
      )
    })
  }

  watch(
    viewer,
    (v) => {
      if (v) void v.dataSources.add(marker)
    },
    { immediate: true },
  )

  watch(unit, (u) => {
    try {
      localStorage.setItem(UNIT_KEY, u)
    } catch {
      /* private mode etc. — the choice lasts this session */
    }
    draw()
  })

  watch(timeline.mode, draw)

  onBeforeUnmount(stopPicking)

  return { unit, spot, reading, loading, error, picking, check, clear, startPicking, stopPicking, checkMyLocation }
}
