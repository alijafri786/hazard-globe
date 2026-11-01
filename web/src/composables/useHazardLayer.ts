import {
  Cartesian2,
  Cartesian3,
  Color,
  CustomDataSource,
  DistanceDisplayCondition,
  Entity,
  GeoJsonDataSource,
  HeightReference,
  LabelStyle,
  NearFarScalar,
  VerticalOrigin,
  type Viewer,
} from 'cesium'
import { computed, onBeforeUnmount, ref, shallowRef, watch, type ShallowRef } from 'vue'
import { api } from '../services/api'
import { escapeHtml } from '../services/html'
import { ALERT_COLOURS, type AlertLevel, type HazardEvent, type HazardType } from '../types'

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
  return `<table class="cesium-infoBox-defaultTable">${table}</table>${link}
    <p style="opacity:.7;font-size:12px">Source: GDACS. Not an official warning — follow your national weather service.</p>`
}

export function useHazardLayer(viewer: ShallowRef<Viewer | null>) {
  const events = shallowRef<HazardEvent[]>([])
  const fetchedAt = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const visible = ref<Record<HazardType, boolean>>({ TC: true, FL: true })

  const points = new CustomDataSource('gdacs-events')
  let footprint: GeoJsonDataSource | null = null

  const sorted = computed(() =>
    [...events.value]
      .filter((e) => visible.value[e.properties.eventtype])
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
          show: visible.value[p.eventtype],
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

  async function showFootprint(e: HazardEvent | null) {
    const v = viewer.value
    if (!v) return
    if (footprint) {
      v.dataSources.remove(footprint, true)
      footprint = null
    }
    if (!e) return v.scene.requestRender()
    const p = e.properties
    try {
      const fc = await api.geometry(p.eventtype, p.eventid, p.episodeid)
      if (!fc.features.length) return
      const colour = Color.fromCssColorString(ALERT_COLOURS[p.alertlevel])
      footprint = await GeoJsonDataSource.load(fc, {
        stroke: colour,
        fill: colour.withAlpha(0.18),
        strokeWidth: 2,
        clampToGround: true,
      })
      // GDACS includes its own centroid points in the geometry; we already draw those.
      for (const ent of footprint.entities.values) if (ent.billboard) ent.show = false
      await v.dataSources.add(footprint)
      v.scene.requestRender()
    } catch {
      /* footprints are a nice-to-have; ignore failures */
    }
  }

  async function refresh() {
    loading.value = true
    error.value = null
    try {
      const res = await api.events()
      events.value = res.features
      fetchedAt.value = res.fetchedAt
      render()
    } catch (err) {
      error.value = (err as Error).message
    } finally {
      loading.value = false
    }
  }

  function flyTo(e: HazardEvent) {
    const v = viewer.value
    const entity = points.entities.getById(`${e.properties.eventtype}-${e.properties.eventid}`)
    if (!v || !entity) return
    v.selectedEntity = entity
    void v.flyTo(entity, { duration: 1.6 })
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
    visible,
    () => {
      for (const ent of points.entities.values) {
        const hazard = ent.properties?.hazard?.getValue() as HazardEvent | undefined
        if (hazard) ent.show = visible.value[hazard.properties.eventtype]
      }
      viewer.value?.scene.requestRender()
    },
    { deep: true },
  )

  // keep data fresh while the tab is open
  const timer = setInterval(() => void refresh(), 10 * 60_000)
  onBeforeUnmount(() => clearInterval(timer))

  return { events: sorted, fetchedAt, loading, error, visible, refresh, flyTo }
}
