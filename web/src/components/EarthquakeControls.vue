<script setup lang="ts">
import { computed } from 'vue'
import { DEPTH_BANDS, QUAKE_FEEDS, USGS_URL, type useEarthquakeLayer } from '../composables/useEarthquakeLayer'
import type { useTimeline } from '../composables/useTimeline'
import type { QuakeFeed } from '../types'

const props = defineProps<{
  quakes: ReturnType<typeof useEarthquakeLayer>
  timeline: ReturnType<typeof useTimeline>
}>()
const { enabled, feed, quakes, generatedAt, loading, error } = props.quakes
const { mode } = props.timeline

const updated = computed(() =>
  generatedAt.value
    ? new Date(generatedAt.value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : null,
)
const feeds = Object.entries(QUAKE_FEEDS) as [QuakeFeed, (typeof QUAKE_FEEDS)[QuakeFeed]][]
</script>

<template>
  <fieldset class="quakes">
    <legend>Earthquakes (USGS)</legend>
    <label class="toggle">
      <input v-model="enabled" type="checkbox" />
      Show every recent earthquake, live
    </label>

    <template v-if="enabled">
      <p v-if="mode === 'history'" class="meta">Live only: hidden while looking back.</p>
      <label class="field">
        <span class="sr-only">Which earthquakes</span>
        <select v-model="feed" aria-label="Which earthquakes">
          <option v-for="[key, f] in feeds" :key="key" :value="key">{{ f.label }}</option>
        </select>
      </label>
      <p v-if="error" class="error">Couldn't load earthquakes: {{ error }}</p>
      <ul class="legend" aria-label="Earthquake depth colours">
        <li v-for="b in DEPTH_BANDS" :key="b.label"><i :style="{ background: b.colour }" />{{ b.label }}</li>
      </ul>
      <p class="meta" role="status">
        <span v-if="loading && !quakes.length">Loading earthquakes…</span>
        <span v-else-if="updated">{{ quakes.length }} earthquakes · USGS feed of {{ updated }}</span>
      </p>
      <p class="credit">
        Bigger dots, stronger quakes; older ones fade. From the
        <a :href="USGS_URL" target="_blank" rel="noopener">USGS</a> real-time feeds, updated every few minutes.
      </p>
    </template>
  </fieldset>
</template>

<style scoped>
.quakes {
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

.field select {
  width: 100%;
  margin-bottom: 6px;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 12px;
  color: var(--muted);
}

.legend i {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 4px;
  border-radius: 50%;
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

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
