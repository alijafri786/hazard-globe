<script setup lang="ts">
import { computed } from 'vue'
import { IBTRACS_URL, MONTHS, STORM_CLASS_LABELS, type useClimatologyLayer } from '../composables/useClimatologyLayer'
import { SEQUENTIAL } from '../services/ramps'
import type { StormClass } from '../types'

const props = defineProps<{ climatology: ReturnType<typeof useClimatologyLayer> }>()
const { enabled, stormClass, month, info, scale, loading, error } = props.climatology

const classes = Object.entries(STORM_CLASS_LABELS) as [StormClass, string][]
const gradient = `linear-gradient(to right, ${SEQUENTIAL.join(', ')})`
const fmt = (n: number) => (n < 1 ? n.toFixed(1) : String(Math.round(n)))
const period = computed(() => (info.value ? `${info.value.from.slice(0, 4)}–${info.value.to.slice(0, 4)}` : 'since 1980'))
</script>

<template>
  <fieldset class="climatology">
    <legend>Storm climatology</legend>
    <label class="toggle">
      <input v-model="enabled" type="checkbox" />
      How often storms pass, {{ period }}
    </label>

    <template v-if="enabled">
      <label class="field">
        <span>Strength</span>
        <select v-model="stormClass">
          <option v-for="[key, label] in classes" :key="key" :value="key">{{ label }}</option>
        </select>
      </label>
      <label class="field">
        <span>When</span>
        <select v-model.number="month">
          <option :value="0">The whole year</option>
          <option v-for="(m, i) in MONTHS" :key="m" :value="i + 1">{{ m }} only</option>
        </select>
      </label>
      <p v-if="error" class="error">Couldn't load the storm climatology: {{ error }}</p>
      <div v-if="scale" class="scale" aria-label="Storms per decade colours">
        <i :style="{ background: gradient }" />
        <div class="ends">
          <span>{{ fmt(scale.min) }}</span>
          <span>{{ fmt(scale.max) }}+ storms a decade</span>
        </div>
      </div>
      <p class="meta" role="status">
        <span v-if="loading && !scale">Loading the storm climatology…</span>
        <span v-else-if="info">{{ info.storms.toLocaleString('en-GB') }} storms, {{ info.from }} to {{ info.to }}</span>
      </p>
      <p class="credit">
        Storms whose centre passed within {{ info?.reachKm ?? 100 }} km, from NOAA's
        <a :href="IBTRACS_URL" target="_blank" rel="noopener">IBTrACS</a> (Knapp et al., 2010). It shows where storms
        have gone, not a forecast; a quiet spot can still be hit.
      </p>
    </template>
  </fieldset>
</template>

<style scoped>
.climatology {
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

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--muted);
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
