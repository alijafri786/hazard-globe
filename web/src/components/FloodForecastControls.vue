<script setup lang="ts">
import { computed } from 'vue'
import {
  FORECAST_LAYERS,
  forecastCredit,
  GLOFAS_URL,
  type ForecastLayer,
  type useFloodForecastLayer,
} from '../composables/useFloodForecastLayer'
import { formatDay, parseGdacsDate, type useTimeline } from '../composables/useTimeline'

const props = defineProps<{
  forecast: ReturnType<typeof useFloodForecastLayer>
  timeline: ReturnType<typeof useTimeline>
}>()
const { enabled, issued, loading, error } = props.forecast
const { mode } = props.timeline

const keys = Object.keys(FORECAST_LAYERS) as ForecastLayer[]
const anyOn = computed(() => keys.some((k) => enabled.value[k]))
const issuedOn = computed(() => {
  const t = parseGdacsDate(issued.value ?? undefined)
  return t === null ? null : formatDay(t)
})

// GloFAS's own colours for the 2-, 5- and 20-year return periods
const LEVELS = [
  { colour: '#ffff00', label: '2-year' },
  { colour: '#ff0000', label: '5-year' },
  { colour: '#a020f0', label: '20-year' },
]
</script>

<template>
  <fieldset class="forecast">
    <legend>Flood forecast (GloFAS)</legend>
    <label v-for="k in keys" :key="k" class="toggle">
      <input v-model="enabled[k]" type="checkbox" />
      {{ FORECAST_LAYERS[k].label }}
    </label>

    <template v-if="anyOn">
      <p v-if="mode === 'history'" class="note">
        This shows today's forecast, so it's hidden while you look at history.
      </p>
      <p v-else-if="error" class="error">{{ error }}</p>
      <template v-else>
        <div class="levels" aria-label="Flood size forecast to be exceeded">
          <span v-for="l in LEVELS" :key="l.label"><i :style="{ background: l.colour }" />{{ l.label }}</span>
        </div>
        <p class="explain">
          Rivers forecast to rise above the level of a flood expected once every 2, 5 or 20 years. Stronger colour, or a
          higher number on a reporting point, means more forecast runs agree. On points, ▲ rising, ▼ falling, ● steady;
          grey dots are other reporting points.
        </p>
        <p class="meta">
          <span v-if="loading">Loading forecast…</span>
          <span v-else-if="issuedOn">Forecast issued {{ issuedOn }}</span>
        </p>
      </template>
      <p class="credit">
        A forecast, not a flood warning, and it doesn't trigger alerts. {{ forecastCredit() }} (<a
          :href="GLOFAS_URL"
          target="_blank"
          rel="noopener"
          >GloFAS</a
        >).
      </p>
    </template>
  </fieldset>
</template>

<style scoped>
.forecast {
  margin: 12px 0;
  padding: 10px 0 0;
  border: none;
  border-top: 1px solid var(--line);
}

legend {
  padding: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
}

.toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 14px;
  cursor: pointer;
}

.levels {
  display: flex;
  gap: 12px;
  margin: 6px 0;
  font-size: 12px;
  color: var(--muted);
}

.levels i {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 4px;
  border-radius: 2px;
  vertical-align: -1px;
}

.explain,
.meta,
.credit,
.note,
.error {
  margin: 6px 0 0;
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

.credit a {
  color: var(--text);
}
</style>
