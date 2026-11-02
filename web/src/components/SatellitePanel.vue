<script setup lang="ts">
import {
  CELESTRAK_URL,
  ORBIT_CLASSES,
  SATELLITE_GROUPS,
  type SatelliteGroup,
  type useSatelliteLayer,
} from '../composables/useSatelliteLayer'
import type { TimelineMode } from '../composables/useTimeline'

const props = defineProps<{ layer: ReturnType<typeof useSatelliteLayer>; mode: TimelineMode }>()
const { groups, groupCounts, count, loading, error, query, matches, flyTo } = props.layer

const keys = Object.keys(SATELLITE_GROUPS) as SatelliteGroup[]
</script>

<template>
  <section>
    <fieldset class="groups">
      <legend>Satellites</legend>
      <label v-for="g in keys" :key="g" class="toggle">
        <input v-model="groups[g]" type="checkbox" />
        {{ SATELLITE_GROUPS[g] }}
        <small v-if="groupCounts[g] !== undefined">{{ groupCounts[g]!.toLocaleString() }}</small>
      </label>
    </fieldset>

    <p v-if="mode === 'history'" class="note">
      Satellites are shown where they are now, so they're hidden while you look at history.
    </p>
    <template v-else-if="count || loading || error">
      <div class="legend">
        <span v-for="(c, k) in ORBIT_CLASSES" :key="k"><i :style="{ background: c.colour }" />{{ c.label }}</span>
      </div>
      <p class="meta" role="status">
        <span v-if="loading">Loading orbits…</span>
        <span v-else>{{ count.toLocaleString() }} {{ count === 1 ? 'satellite' : 'satellites' }}, moving live</span>
      </p>
      <p v-if="error" class="error">Couldn't load some satellites: {{ error }}</p>

      <input
        v-model="query"
        type="text"
        placeholder="Find a satellite, e.g. ISS"
        aria-label="Find a satellite by name or NORAD number"
      />
      <p v-if="query.trim().length >= 2 && !matches.length" class="empty">No satellite shown matches “{{ query }}”.</p>
      <ul class="results">
        <li v-for="el in matches" :key="el.NORAD_CAT_ID">
          <button class="result" @click="flyTo(el)">
            <strong>{{ el.OBJECT_NAME }}</strong>
            <small>NORAD {{ el.NORAD_CAT_ID }} · {{ el.OBJECT_ID }}</small>
          </button>
        </li>
      </ul>
    </template>

    <p class="source">
      Orbits from <a :href="CELESTRAK_URL" target="_blank" rel="noopener">CelesTrak</a>, updated every couple of
      hours. Positions are worked out in your browser and are good to a few kilometres.
    </p>
  </section>
</template>

<style scoped>
.groups {
  margin: 0 0 8px;
  padding: 0;
  border: none;
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

.toggle small {
  margin-left: auto;
  font-size: 12px;
  color: var(--muted);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: 12px;
  color: var(--muted);
}

.legend i {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 4px;
}

.meta {
  margin: 10px 0 8px;
  font-size: 12px;
  color: var(--muted);
}

.results {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}

.result {
  display: flex;
  flex-direction: column;
  width: 100%;
  text-align: left;
  border: none;
  background: none;
  border-radius: 8px;
  padding: 8px;
}

.result strong {
  font-weight: 500;
}

.result small {
  color: var(--muted);
}

.note {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--orange);
}

.error {
  color: var(--red);
  font-size: 14px;
}

.empty {
  color: var(--muted);
  font-size: 14px;
}

.source {
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
}

.source a {
  color: var(--text);
}
</style>
