<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { aqiBand, defaultAqiScale, type AirQuality, type AqiScale } from '../services/openMeteo'

const props = defineProps<{ air: AirQuality; lon: number }>()

const scale = ref<AqiScale>(defaultAqiScale(props.lon))
watch(
  () => props.lon,
  (lon) => (scale.value = defaultAqiScale(lon)),
)

const SCALE_NAMES: Record<AqiScale, string> = { eu: 'European index', us: 'US index' }
const value = computed(() => (scale.value === 'eu' ? props.air.europeanAqi : props.air.usAqi))
const band = computed(() => (value.value === null ? null : aqiBand(scale.value, value.value)))
const fmt = (n: number | null) => (n === null ? '–' : n < 10 ? n.toFixed(1) : String(Math.round(n)))
// WHO's 24-hour guideline for PM10 is 45 µg/m³; desert dust can be many times that
const dusty = computed(() => (props.air.dust ?? 0) >= 50)
</script>

<template>
  <div class="air">
    <p v-if="band && value !== null" class="aqi">
      <i :style="{ background: band.colour }" aria-hidden="true" />
      <span>
        Air quality <strong>{{ Math.round(value) }}</strong>, {{ band.label.toLowerCase() }}
        <small>({{ SCALE_NAMES[scale] }})</small>
      </span>
    </p>
    <dl>
      <dt>PM2.5</dt>
      <dd>{{ fmt(air.pm2_5) }} µg/m³</dd>
      <dt>PM10</dt>
      <dd>{{ fmt(air.pm10) }} µg/m³</dd>
    </dl>
    <p v-if="dusty" class="dust">Desert dust in the air: {{ fmt(air.dust) }} µg/m³.</p>
    <button type="button" class="link" @click="scale = scale === 'eu' ? 'us' : 'eu'">
      Use the {{ scale === 'eu' ? 'US' : 'European' }} index
    </button>
  </div>
</template>

<style scoped>
.air {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
  font-size: 13px;
}

.aqi {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
}

.aqi i {
  flex: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.aqi small {
  color: var(--muted);
}

dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 10px;
  margin: 6px 0 0;
}

dt {
  color: var(--muted);
}

dd {
  margin: 0;
}

.dust {
  margin: 6px 0 0;
  color: var(--orange);
}

.link {
  margin-top: 4px;
  padding: 0;
  border: none;
  background: none;
  font-size: 12px;
  color: var(--accent);
  text-decoration: underline;
}
</style>
