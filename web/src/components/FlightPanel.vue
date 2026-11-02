<script setup lang="ts">
import { computed } from 'vue'
import type { useFlightDetails } from '../composables/useFlightDetails'
import { ALTITUDE_BANDS, type useFlightLayer } from '../composables/useFlightLayer'
import FlightDetails from './FlightDetails.vue'

const props = defineProps<{ layer: ReturnType<typeof useFlightLayer>; card: ReturnType<typeof useFlightDetails> }>()
const { enabled, count, snapshotTime, refreshSeconds, loading, error, query, matches, showCallsigns, refresh, flyTo } =
  props.layer

const updated = computed(() =>
  snapshotTime.value ? new Date(snapshotTime.value).toLocaleTimeString('en-GB', { timeStyle: 'short' }) : null,
)
const every = computed(() => {
  const s = refreshSeconds.value
  return s ? (s >= 120 ? `${Math.round(s / 60)} minutes` : `${s} seconds`) : null
})
</script>

<template>
  <section>
    <FlightDetails :flights="layer" :card="card" />

    <label class="toggle">
      <input v-model="enabled" type="checkbox" />
      Show live flights
    </label>

    <template v-if="enabled">
      <label class="toggle">
        <input v-model="showCallsigns" type="checkbox" />
        Show callsigns when zoomed in
      </label>

      <div class="legend">
        <span v-for="b in ALTITUDE_BANDS" :key="b.label"><i :style="{ background: b.colour }" />{{ b.label }}</span>
      </div>

      <div class="meta">
        <span v-if="updated">{{ count.toLocaleString() }} aircraft · reported {{ updated }}</span>
        <span v-else-if="loading">Loading flights…</span>
        <button :disabled="loading" @click="refresh()">{{ loading ? 'Loading…' : 'Refresh' }}</button>
      </div>

      <p v-if="error" class="error">Couldn't load flights: {{ error }}</p>
      <p v-if="every" class="note">
        New positions every {{ every }}. In between, planes move along their last reported heading, so treat positions
        as approximate.
      </p>

      <input v-model="query" type="text" placeholder="Find a callsign, e.g. BAW" aria-label="Find a flight by callsign" />
      <p v-if="query.trim().length >= 2 && !matches.length" class="empty">No airborne flight matches “{{ query }}”.</p>
      <ul class="flights">
        <li v-for="f in matches" :key="f[0]">
          <button class="flight" @click="flyTo(f)">
            <strong>{{ f[1] || f[0].toUpperCase() }}</strong>
            <small>{{ f[2] }} · {{ f[5].toLocaleString() }} m</small>
          </button>
        </li>
      </ul>
    </template>

    <p class="source">
      Flight data from <a href="https://opensky-network.org" target="_blank" rel="noopener">The OpenSky Network</a>.
    </p>
  </section>
</template>

<style scoped>
.toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  cursor: pointer;
  margin-bottom: 10px;
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
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 12px 0 8px;
  font-size: 12px;
  color: var(--muted);
}

.meta button {
  padding: 4px 10px;
  font-size: 12px;
}

.note {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
}

.flights {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}

.flight {
  display: flex;
  flex-direction: column;
  width: 100%;
  text-align: left;
  border: none;
  background: none;
  border-radius: 8px;
  padding: 8px;
}

.flight strong {
  font-weight: 500;
}

.flight small {
  color: var(--muted);
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
  color: var(--muted);
}

.source a {
  color: var(--text);
}
</style>
