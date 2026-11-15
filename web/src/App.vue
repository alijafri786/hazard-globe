<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AlertSetup from './components/AlertSetup.vue'
import CameraControls from './components/CameraControls.vue'
import EventList from './components/EventList.vue'
import FlightPanel from './components/FlightPanel.vue'
import GibsControls from './components/GibsControls.vue'
import LayerList from './components/LayerList.vue'
import MapLegend from './components/MapLegend.vue'
import SatellitePanel from './components/SatellitePanel.vue'
import ShipPanel from './components/ShipPanel.vue'
import SpaceWeatherCard from './components/SpaceWeatherCard.vue'
import WeatherPanel from './components/WeatherPanel.vue'
import { useAuroraLayer } from './composables/useAuroraLayer'
import { useCameraControls } from './composables/useCameraControls'
import { useClimatologyLayer } from './composables/useClimatologyLayer'
import { useCloudLayer } from './composables/useCloudLayer'
import { useEarthquakeLayer } from './composables/useEarthquakeLayer'
import { useFlightDetails } from './composables/useFlightDetails'
import { useGibsLayers } from './composables/useGibsLayers'
import { useFlightLayer } from './composables/useFlightLayer'
import { useFloodForecastLayer } from './composables/useFloodForecastLayer'
import { useGlobeClicks } from './composables/useGlobeClicks'
import { useHazardLayer } from './composables/useHazardLayer'
import { useSatelliteLayer } from './composables/useSatelliteLayer'
import { useSearchPin } from './composables/useSearchPin'
import { useShipLayer } from './composables/useShipLayer'
import { useTemperature } from './composables/useTemperature'
import { formatDay, useTimeline } from './composables/useTimeline'
import { useTsunamiLayer } from './composables/useTsunamiLayer'
import { useUrlState, type Tab } from './composables/useUrlState'
import { useViewer } from './composables/useViewer'
import { useWatchAreas } from './composables/useWatchAreas'
import { useWindLayer } from './composables/useWindLayer'
import { createLayerRegistry } from './layers/registry'

const globeEl = ref<HTMLElement | null>(null)
const viewer = useViewer(globeEl)
const timeline = useTimeline()
const hazards = useHazardLayer(viewer, timeline)
const forecast = useFloodForecastLayer(viewer, timeline)
const quakes = useEarthquakeLayer(viewer, timeline, hazards.all)
const climatology = useClimatologyLayer(viewer)
const gibs = useGibsLayers(viewer, timeline)
const aurora = useAuroraLayer(viewer, timeline)
const tsunami = useTsunamiLayer(viewer, timeline)
const clouds = useCloudLayer(viewer, timeline)
const wind = useWindLayer(viewer, timeline)
const clicks = useGlobeClicks(viewer)
const flights = useFlightLayer(viewer, clicks, timeline)
const flightCard = useFlightDetails(viewer, flights)
const satellites = useSatelliteLayer(viewer, timeline, clicks)
const ships = useShipLayer(viewer, timeline, clicks)
const watchAreas = useWatchAreas(viewer)
const camera = useCameraControls(viewer)
const search = useSearchPin(viewer)
const temperature = useTemperature(viewer, timeline)
const layers = createLayerRegistry({ hazards, forecast, quakes, climatology, gibs, aurora, tsunami, clouds, wind, flights, ships, satellites, timeline })
const layerListOpen = ref(false)

const panelOpen = ref(true)
const tab = ref<Tab>('events')
const url = useUrlState({
  viewer,
  layers,
  timeline,
  tab,
  loaded: computed(() => [hazards.all.value, quakes.quakes.value]),
  quakeFeed: quakes.feed,
  climatology: { stormClass: climatology.stormClass, month: climatology.month },
  satelliteGroups: satellites.groups,
})

/** Shown inside another site's page: the globe and its key only, with a way out to the full app */
const embedded = new URLSearchParams(location.search).has('embed')
/** Built on the click, so it opens the view as it is now */
function openFullApp() {
  const u = new URL(url.link())
  u.searchParams.delete('embed')
  window.open(u.toString(), '_blank', 'noopener')
}

const shared = ref<string | null>(null)
let sharedTimer: ReturnType<typeof setTimeout> | undefined
async function share() {
  url.flush()
  const link = url.link()
  const note = (text: string) => {
    shared.value = text
    clearTimeout(sharedTimer)
    sharedTimer = setTimeout(() => (shared.value = null), 2500)
  }
  try {
    // A phone's share sheet; on a computer, straight to the clipboard
    if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: 'Hazard Globe', url: link })
    else {
      await navigator.clipboard.writeText(link)
      note('Link copied')
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return // closed the share sheet
    window.prompt('Copy this link to share this view', link)
  }
}

const picking = computed(() => watchAreas.picking.value || temperature.picking.value)

// A pick started on one tab shouldn't land after moving to another
watch(tab, () => {
  watchAreas.stopPicking()
  temperature.stopPicking()
})

// Picking a plane shows its details in the Flights tab
watch(flights.selectedIcao, (icao24) => {
  if (!icao24) return
  tab.value = 'flights'
  panelOpen.value = true
})

// Searching from the Weather tab answers with the weather there
watch(search.found, (place) => {
  if (place && tab.value === 'weather' && timeline.mode.value === 'live') {
    void temperature.check(place.lon, place.lat, place.name)
  }
})
</script>

<template>
  <div ref="globeEl" class="globe" />
  <CameraControls :controls="camera" />

  <a v-if="embedded" class="open-full" href="./" target="_blank" rel="noopener" @click.prevent="openFullApp()">
    Open in Hazard Globe ↗
  </a>

  <aside v-if="!embedded" class="panel" :class="{ collapsed: !panelOpen }">
    <header class="panel-head">
      <div class="head-row">
        <button class="grip" :aria-expanded="panelOpen" @click="panelOpen = !panelOpen">
          <strong>Hazard Globe</strong>
          <span class="chev">{{ panelOpen ? '▾' : '▴' }}</span>
        </button>
        <button type="button" class="share-button" @click="share()">{{ shared ?? 'Share' }}</button>
        <button
          type="button"
          class="layers-button"
          :aria-expanded="layerListOpen"
          aria-haspopup="dialog"
          @click="layerListOpen = !layerListOpen"
        >
          Layers <span class="count">{{ layers.activeCount.value }}</span>
        </button>
      </div>
      <nav v-show="panelOpen" class="tabs" role="tablist">
        <button role="tab" :aria-selected="tab === 'events'" :class="{ on: tab === 'events' }" @click="tab = 'events'">
          Events
        </button>
        <button role="tab" :aria-selected="tab === 'weather'" :class="{ on: tab === 'weather' }" @click="tab = 'weather'">
          Weather
        </button>
        <button role="tab" :aria-selected="tab === 'flights'" :class="{ on: tab === 'flights' }" @click="tab = 'flights'">
          Flights
        </button>
        <button role="tab" :aria-selected="tab === 'space'" :class="{ on: tab === 'space' }" @click="tab = 'space'">
          Sea &amp; space
        </button>
        <button role="tab" :aria-selected="tab === 'alerts'" :class="{ on: tab === 'alerts' }" @click="tab = 'alerts'">
          My alerts
        </button>
      </nav>
    </header>

    <div v-show="panelOpen" class="panel-body">
      <EventList v-if="tab === 'events'" :layer="hazards" :timeline="timeline" :forecast="forecast" :quakes="quakes" :climatology="climatology" :gibs="gibs" :tsunami="tsunami" />
      <WeatherPanel
        v-else-if="tab === 'weather'"
        :weather="temperature"
        :clouds="clouds"
        :wind="wind"
        :gibs="gibs"
        :mode="timeline.mode.value"
        :searched="search.found.value"
      />
      <FlightPanel v-else-if="tab === 'flights'" :layer="flights" :card="flightCard" :mode="timeline.mode.value" />
      <template v-else-if="tab === 'space'">
        <GibsControls :gibs="gibs" tab="space" />
        <SpaceWeatherCard :aurora="aurora" :areas="watchAreas.areas.value" :live="timeline.mode.value === 'live'" />
        <ShipPanel :layer="ships" :mode="timeline.mode.value" />
        <SatellitePanel :layer="satellites" :mode="timeline.mode.value" />
      </template>
      <AlertSetup v-else :watch="watchAreas" />

      <p class="disclaimer">
        Data from <a href="https://www.gdacs.org" target="_blank" rel="noopener">GDACS</a>. This is not an official
        warning service and alerts may be delayed or missed. Always follow your national meteorological and civil
        protection agencies.
      </p>
    </div>
  </aside>

  <!-- Outside the panel, placed against the screen: on a phone the panel is a bottom sheet, and folded
       it has no room below its header -->
  <LayerList v-if="layerListOpen && !embedded" :layers="layers" @close="layerListOpen = false" />
  <MapLegend :layers="layers" :beside="panelOpen && !embedded" />

  <!-- A tsunami warning in force is shown whatever else is on screen, with where to read it -->
  <div v-if="tsunami.active.value.length && timeline.mode.value === 'live'" class="tsunami-banner" role="alert">
    <template v-for="m in tsunami.active.value" :key="m.id">
      <strong>Tsunami {{ m.type }}:</strong> {{ m.region }}.
      <a :href="m.url" target="_blank" rel="noopener">NOAA bulletin ↗</a>
    </template>
    <span>Follow your local authorities.</span>
  </div>

  <!-- So a past day is never mistaken for what is happening now -->
  <div v-if="timeline.mode.value === 'history' && !picking" class="history-badge" role="status">
    History · {{ formatDay(timeline.day.value) }}
    <button @click="timeline.mode.value = 'live'">Back to live</button>
  </div>

  <div v-if="watchAreas.picking.value" class="pick-hint">
    Tap the globe to place this area
    <button @click="watchAreas.stopPicking()">Cancel</button>
  </div>
  <div v-else-if="temperature.picking.value" class="pick-hint">
    Tap the globe to check the temperature
    <button @click="temperature.stopPicking()">Cancel</button>
  </div>
</template>

<style scoped>
.globe {
  position: fixed;
  inset: 0;
}

.panel {
  position: fixed;
  top: 16px;
  left: 16px;
  width: 380px;
  max-height: calc(100% - 32px);
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  backdrop-filter: blur(10px);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
}

.panel-head {
  padding: 12px 12px 0;
}

.head-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.share-button,
.layers-button {
  flex: none;
  padding: 3px 10px;
  font-size: 13px;
}

.layers-button .count {
  display: inline-block;
  min-width: 16px;
  margin-left: 2px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--line);
  font-size: 11px;
}

.tsunami-banner {
  position: fixed;
  top: 0;
  left: 50%;
  z-index: 20;
  transform: translateX(-50%);
  max-width: min(720px, calc(100% - 32px));
  padding: 8px 14px;
  border: 1px solid var(--red);
  border-top: none;
  border-radius: 0 0 10px 10px;
  background: #3a0d12;
  font-size: 14px;
  line-height: 1.4;
}

.tsunami-banner a {
  color: var(--text);
}

.tsunami-banner span {
  display: block;
  font-size: 12px;
  color: var(--muted);
}

.open-full {
  position: fixed;
  top: 12px;
  left: 12px;
  z-index: 2;
  padding: 6px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
  font-size: 14px;
  text-decoration: none;
}

.grip {
  all: unset;
  display: flex;
  flex: 1;
  min-width: 0;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  padding-bottom: 10px;
  font-size: 16px;
}

.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--line);
  overflow-x: auto; /* room for more tabs on narrow screens */
  scrollbar-width: none;
}

.tabs button {
  flex: none;
  padding: 8px 7px;
  font-size: 14px;
  border: none;
  border-radius: 8px 8px 0 0;
  background: none;
  color: var(--muted);
  border-bottom: 2px solid transparent;
}

.tabs button.on {
  color: var(--text);
  border-bottom-color: var(--accent);
}

.panel-body {
  overflow-y: auto;
  padding: 12px;
}

.disclaimer {
  margin: 16px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
}

.disclaimer a {
  color: var(--text);
}

.history-badge {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 6px 6px 6px 14px;
  background: var(--panel);
  border: 1px solid var(--accent);
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}

.history-badge button {
  padding: 4px 10px;
  font-size: 13px;
  font-weight: 400;
}

.pick-hint {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 8px 8px 8px 14px;
  background: var(--accent);
  border-radius: 999px;
  font-size: 14px;
}

/* Mobile: bottom sheet */
@media (max-width: 640px) {
  .panel {
    top: auto;
    bottom: 0;
    left: 0;
    right: 0;
    width: auto;
    max-height: 60%;
    border-radius: var(--radius) var(--radius) 0 0;
    padding-bottom: env(safe-area-inset-bottom);
  }

  .panel.collapsed {
    max-height: none;
  }

  .history-badge {
    top: 8px;
    left: 8px;
    transform: none;
  }
}
</style>
