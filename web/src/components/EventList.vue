<script setup lang="ts">
import { computed } from 'vue'
import type { useFloodForecastLayer } from '../composables/useFloodForecastLayer'
import type { useHazardLayer } from '../composables/useHazardLayer'
import { formatDay, type useTimeline } from '../composables/useTimeline'
import { ALERT_COLOURS, HAZARD_LABELS, type HazardType } from '../types'
import FloodForecastControls from './FloodForecastControls.vue'
import TimelineControls from './TimelineControls.vue'

const props = defineProps<{
  layer: ReturnType<typeof useHazardLayer>
  timeline: ReturnType<typeof useTimeline>
  forecast: ReturnType<typeof useFloodForecastLayer>
}>()
const { events, fetchedAt, days, loading, error, visible, refresh, flyTo } = props.layer
const { mode, day } = props.timeline

const hazardTypes: HazardType[] = ['TC', 'FL']
const updated = computed(() =>
  fetchedAt.value
    ? new Date(fetchedAt.value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
    : null,
)
const empty = computed(() =>
  mode.value === 'history'
    ? `No storm or flood events on ${formatDay(day.value)}.`
    : `No active storm or flood events in the last ${days.value ?? 10} days.`,
)
</script>

<template>
  <section>
    <TimelineControls :timeline="timeline" />

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

    <FloodForecastControls :forecast="forecast" :timeline="timeline" />

    <div class="meta">
      <span v-if="mode === 'history' && !loading">
        {{ events.length }} {{ events.length === 1 ? 'event' : 'events' }} on {{ formatDay(day) }}
      </span>
      <span v-else-if="updated">Updated {{ updated }}</span>
      <button :disabled="loading" @click="refresh()">{{ loading ? 'Loading…' : 'Refresh' }}</button>
    </div>

    <p v-if="error" class="error">Couldn't load events: {{ error }}</p>
    <p v-else-if="!loading && !events.length" class="empty">{{ empty }}</p>

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
