<script setup lang="ts">
import { computed } from 'vue'
import type { useHazardLayer } from '../composables/useHazardLayer'
import { ALERT_COLOURS, HAZARD_LABELS, type HazardType } from '../types'

const props = defineProps<{ layer: ReturnType<typeof useHazardLayer> }>()
const { events, fetchedAt, loading, error, visible, refresh, flyTo } = props.layer

const hazardTypes: HazardType[] = ['TC', 'FL']
const updated = computed(() =>
  fetchedAt.value
    ? new Date(fetchedAt.value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
    : null,
)
</script>

<template>
  <section>
    <div class="toggles">
      <label v-for="h in hazardTypes" :key="h" class="toggle">
        <input v-model="visible[h]" type="checkbox" />
        <span class="ring" :class="h" />
        {{ HAZARD_LABELS[h] }}
      </label>
    </div>

    <div class="legend">
      <span v-for="(c, level) in ALERT_COLOURS" :key="level"><i :style="{ background: c }" />{{ level }}</span>
    </div>

    <div class="meta">
      <span v-if="updated">Updated {{ updated }}</span>
      <button :disabled="loading" @click="refresh()">{{ loading ? 'Loading…' : 'Refresh' }}</button>
    </div>

    <p v-if="error" class="error">Couldn't load events: {{ error }}</p>
    <p v-else-if="!loading && !events.length" class="empty">No active storm or flood events in the last 10 days.</p>

    <ul class="events">
      <li v-for="e in events" :key="`${e.properties.eventtype}-${e.properties.eventid}`">
        <button class="event" @click="flyTo(e)">
          <i class="dot" :style="{ background: ALERT_COLOURS[e.properties.alertlevel] }" />
          <span class="text">
            <strong>{{ e.properties.name || e.properties.description || HAZARD_LABELS[e.properties.eventtype] }}</strong>
            <small>{{ e.properties.eventtype === 'TC' ? 'Cyclone' : 'Flood' }} · {{ e.properties.country || 'Open sea' }}</small>
          </span>
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.toggles {
  display: flex;
  gap: 16px;
  margin-bottom: 10px;
}

.toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  cursor: pointer;
}

.ring {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid #fff;
}

.ring.FL {
  border-color: #4cc3ff;
}

.legend {
  display: flex;
  gap: 12px;
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

.events {
  list-style: none;
  margin: 0;
  padding: 0;
}

.event {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  border: none;
  background: none;
  border-radius: 8px;
  padding: 8px;
}

.dot {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.text strong {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.text small {
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
</style>
