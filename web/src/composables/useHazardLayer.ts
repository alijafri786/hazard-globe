import {
  Cartesian2,
  Cartesian3,
  Color,
  CustomDataSource,
  DistanceDisplayCondition,
  Entity,
  GeoJsonDataSource,
  HeadingPitchRange,
  Math as CesiumMath,
  HeightReference,
  HorizontalOrigin,
  LabelStyle,
  NearFarScalar,
  PolylineDashMaterialProperty,
  VerticalOrigin,
  type Viewer,
} from 'cesium'
import { computed, onBeforeUnmount, ref, shallowRef, watch, type ShallowRef } from 'vue'
import { api } from '../services/api'
import { splitCyclone, type GeoFeature } from '../services/cyclone'
import { escapeHtml } from '../services/html'
import { ALERT_COLOURS, type AlertLevel, type HazardEvent, type HazardType } from '../types'
import { formatDay, type useTimeline } from './useTimeline'

const RANK: Record<AlertLevel, number> = { Red: 2, Orange: 1, Green: 0 }
const HAZARD_OUTLINE: Record<HazardType, Color> = {
  TC: Color.WHITE,
  FL: Color.fromCssColorString('#4cc3ff'),
}

function eventPosition(e: HazardEvent): Cartesian3 | null {
  const g = e.geometry
  if (g?.type !== 'Point' || !Array.isArray(g.coordinates)) return null
  const [lon, lat] = g.coordinates as number[]
  return Number.isFinite(lon) && Number.isFinite(lat) ? Cartesian3.fromDegrees(lon, lat) : null
}

function describe(e: HazardEvent): string {
  const p = e.properties
  const rows = [
    ['Alert', p.alertlevel],
    ['Country', p.country],
    ['Started', p.fromdate?.slice(0, 10)],
    ['Last update', p.todate?.slice(0, 10)],
    ['Severity', p.severitydata?.severitytext],
  ].filter(([, v]) => v)
  const table = rows.map(([k, v]) => `<tr><th>${k}</th><td>${escapeHtml(String(v))}</td></tr>`).join('')
  const link = p.url?.report
    ? `<p><a href="${escapeHtml(p.url.report)}" target="_blank" rel="noopener">Full GDACS report ↗</a></p>`
    : ''
  const track =
    p.eventtype === 'TC'
      ? `<p style="font-size:13px">Track: solid where it has been, dashed where it is forecast to go. The dashed white
        cone is where its centre is likely to go, not how big the storm is.</p>`
      : ''
  return `<table class="cesium-infoBox-defaultTable">${table}</table>${track}${link}
    <p style="opacity:.7;font-size:12px">Source: GDACS. Not an official warning — follow your national weather service.</p>`
}

export function useHazardLayer(viewer: ShallowRef<Viewer | null>, timeline: ReturnType<typeof useTimeline>) {
  const events = shallowRef<HazardEvent[]>([])
  const fetchedAt = ref<string | null>(null)
  /** how many days back the loaded events reach */
  const days = ref<number | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const visible = ref<Record<HazardType, boolean>>({ TC: true, FL: true })

  const points = new CustomDataSource('gdacs-events')
  let footprint: GeoJsonDataSource | null = null
  let forecast: CustomDataSource | null = null

  /** Its hazard type is switched on, and it was active on the timeline's day */
  const shown = (e: HazardEvent) => visible.value[e.properties.eventtype] && timeline.shows(e)

  const sorted = computed(() =>
    [...events.value]
      .filter(shown)
      .sort((a, b) => RANK[b.properties.alertlevel] - RANK[a.properties.alertlevel]),
  )

  function render() {
    points.entities.removeAll()
    for (const e of events.value) {
      const position = eventPosition(e)
      if (!position) continue
      const p = e.properties
      const colour = Color.fromCssColorString(ALERT_COLOURS[p.alertlevel] ?? '#888')
      points.entities.add(
        new Entity({
          id: `${p.eventtype}-${p.eventid}`,
          name: p.name || p.description || `${p.eventtype} ${p.eventid}`,
          position,
          show: shown(e),
          description: describe(e),
          point: {
            pixelSize: 8 + RANK[p.alertlevel] * 4,
            color: colour,
            outlineColor: HAZARD_OUTLINE[p.eventtype],
            outlineWidth: 2,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            scaleByDistance: new NearFarScalar(1e6, 1.4, 2e7, 0.8),
            // No disableDepthTestDistance: it would draw markers through the Earth from the far side.
            // With the globe's default depthTestAgainstTerrain = false, Cesium still hides anything
            // behind the globe but draws ground-clamped markers over hills instead of half-burying them.
          },
          label: {
            text: p.name || '',
            font: '13px system-ui, sans-serif',
            style: LabelStyle.FILL_AND_OUTLINE,
            outlineWidth: 3,
            outlineColor: Color.BLACK,
            verticalOrigin: VerticalOrigin.BOTTOM,
            pixelOffset: new Cartesian2(0, -14),
            distanceDisplayCondition: new DistanceDisplayCondition(0, 6e6),
          },
          properties: { hazard: e },
        }),
      )
    }
    viewer.value?.scene.requestRender()
  }

  /** A cyclone's track and forecast cone, drawn apart from its wind area so neither reads as the other */
  function drawForecast(parts: ReturnType<typeof splitCyclone>): CustomDataSource {
    const source = new CustomDataSource('cyclone-forecast')
    const positions = (coords: number[][]) => Cartesian3.fromDegreesArray(coords.flat())
    const dashed = new PolylineDashMaterialProperty({ color: Color.WHITE, dashLength: 14 })
    if (parts.cone) {
      source.entities.add({
        polygon: { hierarchy: positions(parts.cone), material: Color.WHITE.withAlpha(0.07) },
        polyline: { positions: positions(parts.cone), width: 2, material: dashed, clampToGround: true },
      })
    }
    for (const line of parts.track) {
      source.entities.add({
        polyline: {
          positions: positions(line.coords),
          width: 2,
          clampToGround: true,
          material: line.forecast ? dashed : Color.WHITE,
        },
      })
    }
    for (const point of parts.forecastPoints) {
      const hour = new Date(point.time).getUTCHours().toString().padStart(2, '0')
      source.entities.add({
        position: Cartesian3.fromDegrees(point.lon, point.lat),
        point: {
          pixelSize: 6,
          color: Color.WHITE,
          outlineColor: Color.BLACK,
          outlineWidth: 1,
          heightReference: HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: `${formatDay(point.time)} ${hour}:00 UTC`,
          font: '11px system-ui, sans-serif',
          style: LabelStyle.FILL_AND_OUTLINE,
          outlineWidth: 3,
          outlineColor: Color.BLACK,
          horizontalOrigin: HorizontalOrigin.LEFT,
          pixelOffset: new Cartesian2(8, 0),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 5e6),
        },
      })
    }
    return source
  }

  async function showFootprint(e: HazardEvent | null) {
    const v = viewer.value
    if (!v) return
    for (const source of [footprint, forecast]) if (source) v.dataSources.remove(source, true)
    footprint = forecast = null
    if (!e) return v.scene.requestRender()
    const p = e.properties
    try {
      const fc = await api.geometry(p.eventtype, p.eventid, p.episodeid)
      if (!fc.features.length) return
      // The cone, track and centroid are not the area hit: drawn separately, or (the centroid) not at all
      const parts = splitCyclone(fc.features as GeoFeature[], p.eventtype)
      const colour = Color.fromCssColorString(ALERT_COLOURS[p.alertlevel])
      footprint = await GeoJsonDataSource.load(
        { type: 'FeatureCollection', features: parts.area },
        { stroke: colour, fill: colour.withAlpha(0.18), strokeWidth: 2, clampToGround: true },
      )
      // Flood geometry includes GDACS's own centroid point; we already draw a marker there
      for (const ent of footprint.entities.values) if (ent.billboard) ent.show = false
      await v.dataSources.add(footprint)
      if (p.eventtype === 'TC') await v.dataSources.add((forecast = drawForecast(parts)))
      v.scene.requestRender()
    } catch {
      /* footprints are a nice-to-have; ignore failures */
    }
  }

  let latestRequest = 0

  async function refresh() {
    const request = ++latestRequest
    loading.value = true
    error.value = null
    try {
      const res = timeline.mode.value === 'history' ? await api.history(timeline.days.value) : await api.events()
      if (request !== latestRequest) return // switched mode or range meanwhile: a newer request wins
      events.value = res.features
      fetchedAt.value = res.fetchedAt
      days.value = res.days
      render()
    } catch (err) {
      if (request === latestRequest) error.value = (err as Error).message
    } finally {
      if (request === latestRequest) loading.value = false
    }
  }

  function flyTo(e: HazardEvent) {
    const v = viewer.value
    const entity = points.entities.getById(`${e.properties.eventtype}-${e.properties.eventid}`)
    if (!v || !entity) return
    v.selectedEntity = entity
    // From high enough above to take in a storm's track and cone, not just the marker
    void v.flyTo(entity, { duration: 1.6, offset: new HeadingPitchRange(0, CesiumMath.toRadians(-90), 2.5e6) })
  }

  watch(
    viewer,
    (v) => {
      if (!v) return
      void v.dataSources.add(points)
      v.selectedEntityChanged.addEventListener((entity?: Entity) => {
        const hazard = entity?.properties?.hazard?.getValue() as HazardEvent | undefined
        void showFootprint(hazard ?? null)
      })
      void refresh()
    },
    { immediate: true },
  )

  watch(
    [visible, timeline.day, timeline.mode],
    () => {
      for (const ent of points.entities.values) {
        const hazard = ent.properties?.hazard?.getValue() as HazardEvent | undefined
        if (hazard) ent.show = shown(hazard)
      }
      viewer.value?.scene.requestRender()
    },
    { deep: true },
  )

  watch([timeline.mode, timeline.days], ([mode], [prevMode]) => {
    if (mode === 'history' || prevMode === 'history') void refresh()
  })

  // keep live data fresh while the tab is open; history only changes once a day
  const timer = setInterval(() => timeline.mode.value === 'live' && void refresh(), 10 * 60_000)
  onBeforeUnmount(() => clearInterval(timer))

  return { events: sorted, fetchedAt, days, loading, error, visible, refresh, flyTo }
}
