<script setup lang="ts">
import { computed } from 'vue'
import { AISSTREAM_URL, SHIP_KINDS, type useShipLayer } from '../composables/useShipLayer'
import type { TimelineMode } from '../composables/useTimeline'

const props = defineProps<{ layer: ReturnType<typeof useShipLayer>; mode: TimelineMode }>()
const { enabled, count, snapshotTime, collectingSince, loading, error, unavailable, query, matches, flyTo } = props.layer

const updated = computed(() =>
  snapshotTime.value ? new Date(snapshotTime.value).toLocaleTimeString('en-GB', { timeStyle: 'short' }) : null,
)
/** Positions build up over the first minutes of the server's feed */
const warmingUp = computed(() => {
  const since = collectingSince.value
  return since !== null && snapshotTime.value !== null && Date.parse(snapshotTime.value) - Date.parse(since) < 10 * 60_000
})
</script>

<template>
  <fieldset class="ships">
    <legend>Ships</legend>
    <label class="toggle">
      <input v-model="enabled" type="checkbox" />
      Show ships
    </label>

    <template v-if="enabled">
      <p v-if="unavailable" class="note">
        Ships aren't set up on this server: it needs a free AISStream.io key (see the README).
      </p>
      <p v-else-if="mode === 'history'" class="note">
        Ships are shown where they are now, so they're hidden while you look at history.
      </p>
      <template v-else>
        <p v-if="error" class="error">Couldn't get ships: {{ error }}</p>
        <p v-if="warmingUp" class="note">
          Collecting positions: ships appear over the first few minutes, as each one reports.
        </p>
        <div class="legend">
          <span v-for="k in SHIP_KINDS" :key="k.label"><i :style="{ background: k.colour }" />{{ k.label }}</span>
        </div>
        <p class="meta" role="status">
          <span v-if="updated">
            {{ count.toLocaleString() }} {{ count === 1 ? 'ship' : 'ships' }} · reported {{ updated }}
          </span>
          <span v-else-if="loading">Loading ships…</span>
        </p>
        <p class="explain">
          From receivers on land, so busy coasts and shipping lanes are well covered and the open ocean hardly at
          all. Between reports, ships move along their last course.
        </p>

        <input
          v-model="query"
          type="text"
          placeholder="Find a ship by name or MMSI"
          aria-label="Find a ship by name or MMSI"
        />
        <p v-if="query.trim().length >= 2 && !matches.length" class="empty">No ship shown matches “{{ query }}”.</p>
        <ul class="results">
          <li v-for="s in matches" :key="s[0]">
            <button class="result" @click="flyTo(s)">
              <strong>{{ s[1] || `MMSI ${s[0]}` }}</strong>
              <small>MMSI {{ s[0] }}<template v-if="s[5] != null"> · {{ s[5].toFixed(1) }} kn</template></small>
            </button>
          </li>
        </ul>
      </template>
      <p class="credit">AIS from <a :href="AISSTREAM_URL" target="_blank" rel="noopener">AISStream.io</a>.</p>
    </template>
  </fieldset>
</template>

<style scoped>
.ships {
  margin: 0 0 12px;
  padding: 0 0 12px;
  border: none;
  border-bottom: 1px solid var(--line);
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
  margin: 10px 0 6px;
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

.explain,
.note,
.credit {
  margin: 6px 0 10px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
}

.note {
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

.credit a {
  color: var(--text);
}
</style>
