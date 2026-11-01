<script setup lang="ts">
import { computed, ref } from 'vue'
import { compassPoint, formatTemperature, formatWind, localTime, type useTemperature } from '../composables/useTemperature'
import type { TimelineMode } from '../composables/useTimeline'
import { formatCoordinates, type Place } from '../services/geocoders'
import { OPEN_METEO_URL } from '../services/openMeteo'

const props = defineProps<{
  weather: ReturnType<typeof useTemperature>
  mode: TimelineMode
  /** The place last found with the globe's search box */
  searched: Place | null
}>()
const { unit, spot, reading, loading, error, check, clear, startPicking, checkMyLocation } = props.weather

const locating = ref(false)
const locateError = ref<string | null>(null)

async function locate() {
  locating.value = true
  locateError.value = null
  try {
    await checkMyLocation()
  } catch (err) {
    locateError.value = (err as Error).message
  } finally {
    locating.value = false
  }
}

const title = computed(() => spot.value && (spot.value.name ?? formatCoordinates(spot.value.lon, spot.value.lat)))
/** Offered when search found somewhere that isn't what's showing */
const searchedElsewhere = computed(() => {
  const p = props.searched
  return p && !(spot.value?.lon === p.lon && spot.value.lat === p.lat) ? p : null
})
</script>

<template>
  <section>
    <fieldset class="probe">
      <legend>Temperature anywhere</legend>
      <p v-if="mode === 'history'" class="note">
        This shows the weather now, so it's hidden while you look at history.
      </p>
      <template v-else>
        <div class="actions">
          <button @click="startPicking()">Pick on globe</button>
          <button :disabled="locating" @click="locate()">{{ locating ? 'Locating…' : 'Use my location' }}</button>
        </div>
        <button
          v-if="searchedElsewhere"
          class="searched"
          @click="check(searchedElsewhere.lon, searchedElsewhere.lat, searchedElsewhere.name)"
        >
          Check {{ searchedElsewhere.label }}
        </button>
        <p v-if="locateError" class="error">{{ locateError }}</p>

        <div v-if="spot" class="card" aria-live="polite">
          <div class="card-head">
            <strong>{{ title }}</strong>
            <button class="close" aria-label="Clear" @click="clear()">×</button>
          </div>
          <p v-if="loading" class="meta">Checking…</p>
          <p v-else-if="error" class="error">Couldn't get the weather: {{ error }}</p>
          <template v-else-if="reading">
            <div class="now">
              <span class="temperature">{{ formatTemperature(reading.temperatureC, unit) }}</span>
              <span>{{ reading.conditions }}</span>
            </div>
            <dl>
              <dt>Feels like</dt>
              <dd>{{ formatTemperature(reading.feelsLikeC, unit) }}</dd>
              <dt>Humidity</dt>
              <dd>{{ reading.humidityPct }}%</dd>
              <dt>Wind</dt>
              <dd>{{ formatWind(reading.windKmh, unit) }} from the {{ compassPoint(reading.windFromDeg) }}</dd>
              <dt>Local time</dt>
              <dd>{{ localTime(reading) }} {{ reading.timezoneAbbreviation }}</dd>
            </dl>
          </template>
        </div>
        <p v-else class="meta">Pick a spot on the globe, use your location, or search for a place.</p>

        <div class="units" role="group" aria-label="Units">
          <button :aria-pressed="unit === 'C'" :class="{ on: unit === 'C' }" @click="unit = 'C'">°C, km/h</button>
          <button :aria-pressed="unit === 'F'" :class="{ on: unit === 'F' }" @click="unit = 'F'">°F, mph</button>
        </div>
        <p class="source">
          Weather data by <a :href="OPEN_METEO_URL" target="_blank" rel="noopener">Open-Meteo.com</a>, from weather
          models rather than a nearby station, so it's for a patch of a few kilometres around the spot.
        </p>
      </template>
    </fieldset>
  </section>
</template>

<style scoped>
.probe {
  margin: 0;
  padding: 0;
  border: none;
}

legend {
  padding: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
}

.actions {
  display: flex;
  gap: 6px;
}

.searched {
  margin-top: 6px;
  width: 100%;
  text-align: left;
}

.card {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
}

.card-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  font-size: 14px;
}

.card-head strong {
  font-weight: 500;
  line-height: 1.35;
}

.close {
  flex: none;
  padding: 0 8px;
  border: none;
  background: none;
  font-size: 18px;
  line-height: 1.2;
  color: var(--muted);
}

.now {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 8px 0;
}

.temperature {
  font-size: 32px;
  font-weight: 600;
}

dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  margin: 0;
  font-size: 13px;
}

dt {
  color: var(--muted);
}

dd {
  margin: 0;
}

.units {
  display: flex;
  gap: 4px;
  margin-top: 12px;
}

.units button {
  padding: 4px 12px;
  font-size: 13px;
  color: var(--muted);
}

.units button.on {
  color: var(--text);
  border-color: var(--accent);
  background: rgba(124, 92, 255, 0.18);
}

.meta,
.note,
.error,
.source {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
}

.note {
  color: var(--orange);
}

.error {
  color: var(--red);
}

.source a {
  color: var(--text);
}
</style>
