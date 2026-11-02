<script setup lang="ts">
import { computed } from 'vue'
import { GFS_URL, WIND_SCALE, type useWindLayer } from '../composables/useWindLayer'

const props = defineProps<{ wind: ReturnType<typeof useWindLayer> }>()
const { enabled, grid, loading, error } = props.wind

const forecastFor = computed(() =>
  grid.value
    ? new Date(grid.value.validTime).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    : null,
)
const gradient = `linear-gradient(to right, ${WIND_SCALE.colours.join(', ')})`
const kmh = (ms: number) => Math.round(ms * 3.6)
</script>

<template>
  <fieldset class="wind">
    <legend>Wind</legend>
    <label class="toggle">
      <input v-model="enabled" type="checkbox" />
      Show wind, moving
    </label>

    <template v-if="enabled">
      <p v-if="error" class="error">Couldn't load the wind: {{ error }}</p>
      <div class="scale" aria-label="Wind speed colours">
        <i :style="{ background: gradient }" />
        <div class="ends">
          <span>Calm</span>
          <span>{{ kmh(WIND_SCALE.max / 2) }} km/h</span>
          <span>{{ kmh(WIND_SCALE.max) }}+ km/h</span>
        </div>
      </div>
      <p class="meta" role="status">
        <span v-if="loading && !grid">Loading the wind…</span>
        <span v-else-if="forecastFor">Forecast for {{ forecastFor }}, 10 m above the ground</span>
      </p>
      <p class="credit">
        <a :href="GFS_URL" target="_blank" rel="noopener">NOAA GFS</a> forecast model, on a 1° grid (about 100 km), so
        it shows the large-scale flow rather than local gusts.
      </p>
    </template>
  </fieldset>
</template>

<style scoped>
.wind {
  margin: 0 0 12px;
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

.scale i {
  display: block;
  height: 8px;
  border-radius: 4px;
}

.ends {
  display: flex;
  justify-content: space-between;
  margin-top: 2px;
  font-size: 11px;
  color: var(--muted);
}

.meta,
.credit,
.error {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
}

.error {
  color: var(--red);
}

.credit a {
  color: var(--text);
}
</style>
