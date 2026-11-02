<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AlertSetup from './components/AlertSetup.vue'
import CameraControls from './components/CameraControls.vue'
import EventList from './components/EventList.vue'
import FlightPanel from './components/FlightPanel.vue'
import SatellitePanel from './components/SatellitePanel.vue'
import ShipPanel from './components/ShipPanel.vue'
import WeatherPanel from './components/WeatherPanel.vue'
import { useCameraControls } from './composables/useCameraControls'
import { useCloudLayer } from './composables/useCloudLayer'
import { useFlightDetails } from './composables/useFlightDetails'
import { useFlightLayer } from './composables/useFlightLayer'
import { useFloodForecastLayer } from './composables/useFloodForecastLayer'
import { useGlobeClicks } from './composables/useGlobeClicks'
import { useHazardLayer } from './composables/useHazardLayer'
import { useSatelliteLayer } from './composables/useSatelliteLayer'
import { useSearchPin } from './composables/useSearchPin'
import { useShipLayer } from './composables/useShipLayer'
import { useTemperature } from './composables/useTemperature'
import { formatDay, useTimeline } from './composables/useTimeline'
import { useViewer } from './composables/useViewer'
import { useWatchAreas } from './composables/useWatchAreas'

const globeEl = ref<HTMLElement | null>(null)
const viewer = useViewer(globeEl)
const timeline = useTimeline()
const hazards = useHazardLayer(viewer, timeline)
const forecast = useFloodForecastLayer(viewer, timeline)
const clouds = useCloudLayer(viewer, timeline)
const clicks = useGlobeClicks(viewer)
const flights = useFlightLayer(viewer, clicks, timeline)
const flightCard = useFlightDetails(viewer, flights)
const satellites = useSatelliteLayer(viewer, timeline, clicks)
const ships = useShipLayer(viewer, timeline, clicks)
const watchAreas = useWatchAreas(viewer)
const camera = useCameraControls(viewer)
const search = useSearchPin(viewer)
const temperature = useTemperature(viewer, timeline)

const panelOpen = ref(true)
const tab = ref<'events' | 'weather' | 'flights' | 'space' | 'alerts'>('events')

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

  <aside class="panel" :class="{ collapsed: !panelOpen }">
    <header class="panel-head">
      <button class="grip" :aria-expanded="panelOpen" @click="panelOpen = !panelOpen">
        <strong>Hazard Globe</strong>
        <span class="chev">{{ panelOpen ? '▾' : '▴' }}</span>
      </button>
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
      <EventList v-if="tab === 'events'" :layer="hazards" :timeline="timeline" :forecast="forecast" />
      <WeatherPanel
        v-else-if="tab === 'weather'"
        :weather="temperature"
        :clouds="clouds"
        :mode="timeline.mode.value"
        :searched="search.found.value"
      />
      <FlightPanel v-else-if="tab === 'flights'" :layer="flights" :card="flightCard" :mode="timeline.mode.value" />
      <template v-else-if="tab === 'space'">
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

.grip {
  all: unset;
  display: flex;
  width: 100%;
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
