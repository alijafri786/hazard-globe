import { computed, type ComputedRef, type WritableComputedRef } from 'vue'
import { AURORA_COLOURS, AURORA_MAX, AURORA_MIN, type useAuroraLayer } from '../composables/useAuroraLayer'
import type { useClimatologyLayer } from '../composables/useClimatologyLayer'
import type { useCloudLayer } from '../composables/useCloudLayer'
import { DEPTH_BANDS, type useEarthquakeLayer } from '../composables/useEarthquakeLayer'
import { ALTITUDE_BANDS, type useFlightLayer } from '../composables/useFlightLayer'
import type { useGibsLayers } from '../composables/useGibsLayers'
import { FLOOD_LEVELS, FORECAST_LAYERS, type useFloodForecastLayer } from '../composables/useFloodForecastLayer'
import type { useHazardLayer } from '../composables/useHazardLayer'
import { ORBIT_CLASSES, SATELLITE_GROUPS, type SatelliteGroup, type useSatelliteLayer } from '../composables/useSatelliteLayer'
import { SHIP_KINDS, type useShipLayer } from '../composables/useShipLayer'
import type { useTimeline } from '../composables/useTimeline'
import { WIND_SCALE, type useWindLayer } from '../composables/useWindLayer'
import { HAZARD_TYPES, HAZARDS, hazardSymbol } from '../hazards'
import { GIBS, GIBS_IDS } from './gibs'
import { SEQUENTIAL } from '../services/ramps'
import { ALERT_COLOURS } from '../types'

export type LayerGroup = 'Events' | 'Weather' | 'Flights' | 'Sea & space'
export const LAYER_GROUPS: LayerGroup[] = ['Events', 'Weather', 'Flights', 'Sea & space']

export interface Swatch {
  colour: string
  label: string
  /** an image to show instead of a dot, e.g. a hazard's marker shape */
  image?: string
}

export type Legend =
  | { title: string; swatches: Swatch[] }
  | { title: string; gradient: readonly string[]; ends: string[] }

export interface LayerEntry {
  id: string
  label: string
  group: LayerGroup
  /** Two-way: reading says whether it's switched on, writing switches it */
  on: WritableComputedRef<boolean>
  /** Shows only what's happening now, so it's hidden while looking back in History */
  liveOnly: boolean
}

export interface LayerDeps {
  hazards: ReturnType<typeof useHazardLayer>
  forecast: ReturnType<typeof useFloodForecastLayer>
  quakes: ReturnType<typeof useEarthquakeLayer>
  climatology: ReturnType<typeof useClimatologyLayer>
  gibs: ReturnType<typeof useGibsLayers>
  aurora: ReturnType<typeof useAuroraLayer>
  clouds: ReturnType<typeof useCloudLayer>
  wind: ReturnType<typeof useWindLayer>
  flights: ReturnType<typeof useFlightLayer>
  ships: ReturnType<typeof useShipLayer>
  satellites: ReturnType<typeof useSatelliteLayer>
  timeline: ReturnType<typeof useTimeline>
}

const toggle = (get: () => boolean, set: (on: boolean) => void) => computed({ get, set })

// What the satellites switch turns on: the few hundred brightest, not tens of thousands of Starlinks
const DEFAULT_SATELLITES: SatelliteGroup[] = ['stations', 'visual']
const kmh = (ms: number) => Math.round(ms * 3.6)

/**
 * Every layer the globe can show, in one list: what the layer list switches and the legend describes.
 * Each tab keeps its own detailed controls; these are the same switches, not copies of the state.
 */
export function createLayerRegistry(d: LayerDeps) {
  const entries: LayerEntry[] = [
    ...HAZARD_TYPES.map(
      (t): LayerEntry => ({
        id: `gdacs-${t}`,
        label: HAZARDS[t].label,
        group: 'Events',
        on: toggle(
          () => d.hazards.visible.value[t],
          (on) => (d.hazards.visible.value[t] = on),
        ),
        liveOnly: false,
      }),
    ),
    {
      id: 'usgs-quakes',
      label: 'Earthquakes, live (USGS)',
      group: 'Events',
      on: toggle(
        () => d.quakes.enabled.value,
        (on) => (d.quakes.enabled.value = on),
      ),
      liveOnly: true,
    },
    {
      id: 'climatology',
      label: 'Storm climatology',
      group: 'Events',
      on: toggle(
        () => d.climatology.enabled.value,
        (on) => (d.climatology.enabled.value = on),
      ),
      liveOnly: false, // about past decades, so as true of a past day as of today
    },
    ...(Object.keys(FORECAST_LAYERS) as (keyof typeof FORECAST_LAYERS)[]).map(
      (k): LayerEntry => ({
        id: `glofas-${k}`,
        label: FORECAST_LAYERS[k].label,
        group: 'Events',
        on: toggle(
          () => d.forecast.enabled.value[k],
          (on) => (d.forecast.enabled.value[k] = on),
        ),
        liveOnly: true,
      }),
    ),
    {
      id: 'clouds',
      label: 'Clouds',
      group: 'Weather',
      on: toggle(
        () => d.clouds.enabled.value,
        (on) => (d.clouds.enabled.value = on),
      ),
      liveOnly: true,
    },
    ...GIBS_IDS.map(
      (id): LayerEntry => ({
        id: `gibs-${id}`,
        label: GIBS[id].label,
        group: ({ events: 'Events', weather: 'Weather', space: 'Sea & space' } as const)[GIBS[id].tab],
        on: toggle(
          () => d.gibs.on.value[id],
          (on) => (d.gibs.on.value[id] = on),
        ),
        liveOnly: false, // daily maps: History shows the day looked at
      }),
    ),
    {
      id: 'wind',
      label: 'Wind',
      group: 'Weather',
      on: toggle(
        () => d.wind.enabled.value,
        (on) => (d.wind.enabled.value = on),
      ),
      liveOnly: true,
    },
    {
      id: 'flights',
      label: 'Flights',
      group: 'Flights',
      on: toggle(
        () => d.flights.enabled.value,
        (on) => (d.flights.enabled.value = on),
      ),
      liveOnly: true,
    },
    {
      id: 'ships',
      label: 'Ships',
      group: 'Sea & space',
      on: toggle(
        () => d.ships.enabled.value,
        (on) => (d.ships.enabled.value = on),
      ),
      liveOnly: true,
    },
    {
      id: 'aurora',
      label: 'Aurora forecast',
      group: 'Sea & space',
      on: toggle(
        () => d.aurora.enabled.value,
        (on) => (d.aurora.enabled.value = on),
      ),
      liveOnly: true,
    },
    {
      id: 'satellites',
      label: 'Satellites',
      group: 'Sea & space',
      on: toggle(
        () => Object.values(d.satellites.groups.value).some(Boolean),
        // One assignment, so the layer reloads once rather than once per group
        (on) =>
          (d.satellites.groups.value = Object.fromEntries(
            (Object.keys(SATELLITE_GROUPS) as SatelliteGroup[]).map((g) => [g, on && DEFAULT_SATELLITES.includes(g)]),
          ) as Record<SatelliteGroup, boolean>),
      ),
      liveOnly: true,
    },
  ]

  const live = computed(() => d.timeline.mode.value === 'live')
  /** Switched on, and showing in the current mode */
  const showing = (id: string) => {
    const e = entries.find((x) => x.id === id)
    return Boolean(e?.on.value && (live.value || !e.liveOnly))
  }

  /** The legends for what's on the globe now, one per kind of layer */
  const legends: ComputedRef<Legend[]> = computed(() => {
    const out: Legend[] = []
    const hazardTypes = HAZARD_TYPES.filter((t) => showing(`gdacs-${t}`))
    if (hazardTypes.length) {
      // The shape says what it is, the fill its alert level: two keys, so neither reads as part of the other
      out.push({
        title: 'GDACS events',
        swatches: hazardTypes.map((t) => ({ colour: 'transparent', label: HAZARDS[t].label, image: hazardSymbol(t, 'transparent') })),
      })
      out.push({
        title: 'GDACS alert level',
        swatches: (Object.entries(ALERT_COLOURS) as [string, string][]).map(([level, colour]) => ({ colour, label: level })),
      })
    }
    const scale = d.climatology.scale.value
    if (showing('climatology') && scale) {
      const fmt = (n: number) => (n < 1 ? n.toFixed(1) : String(Math.round(n)))
      out.push({
        title: `Storms a decade within ${d.climatology.info.value?.reachKm ?? 100} km`,
        gradient: SEQUENTIAL,
        ends: [fmt(scale.min), `${fmt(scale.max)}+`],
      })
    }
    if (showing('usgs-quakes')) {
      out.push({ title: 'Earthquakes by depth (USGS)', swatches: DEPTH_BANDS.map((b) => ({ colour: b.colour, label: b.label })) })
    }
    if (showing('glofas-summary') || showing('glofas-points')) {
      out.push({ title: 'Flood forecast (GloFAS)', swatches: FLOOD_LEVELS.map((l) => ({ ...l })) })
    }
    for (const id of GIBS_IDS) {
      if (!showing(`gibs-${id}`)) continue
      const { title, colours, ends } = GIBS[id].legend
      out.push(ends.length ? { title, gradient: colours, ends } : { title: 'NASA', swatches: [{ colour: colours[0], label: title }] })
    }
    if (showing('aurora')) {
      out.push({ title: 'Aurora, % chance overhead', gradient: AURORA_COLOURS, ends: [`${AURORA_MIN}`, `${AURORA_MAX}+`] })
    }
    if (showing('wind')) {
      out.push({ title: 'Wind', gradient: WIND_SCALE.colours, ends: ['Calm', `${kmh(WIND_SCALE.max)}+ km/h`] })
    }
    if (showing('flights')) {
      out.push({ title: 'Flights by altitude', swatches: ALTITUDE_BANDS.map((b) => ({ colour: b.colour, label: b.label })) })
    }
    if (showing('ships')) {
      out.push({ title: 'Ships', swatches: SHIP_KINDS.map((k) => ({ colour: k.colour, label: k.label })) })
    }
    if (showing('satellites')) {
      out.push({ title: 'Satellites by orbit', swatches: Object.values(ORBIT_CLASSES).map((c) => ({ ...c })) })
    }
    return out
  })

  const activeCount = computed(() => entries.filter((e) => e.on.value).length)

  /** Switches off everything but the GDACS events, which are what the globe is for */
  function reset() {
    for (const e of entries) e.on.value = e.id.startsWith('gdacs-')
  }

  return { entries, legends, activeCount, live, reset }
}

export type LayerRegistry = ReturnType<typeof createLayerRegistry>
