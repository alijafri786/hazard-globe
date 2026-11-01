<script setup lang="ts">
import { computed } from 'vue'
import { formatDay, HISTORY_DAYS, type useTimeline } from '../composables/useTimeline'

const props = defineProps<{ timeline: ReturnType<typeof useTimeline> }>()
const { mode, days, dayList, index, day, playing, toggle } = props.timeline

const label = computed(() => formatDay(day.value))
const first = computed(() => formatDay(dayList.value[0]))
</script>

<template>
  <div class="timeline">
    <div class="modes" role="group" aria-label="Which events">
      <button :aria-pressed="mode === 'live'" :class="{ on: mode === 'live' }" @click="mode = 'live'">Live</button>
      <button :aria-pressed="mode === 'history'" :class="{ on: mode === 'history' }" @click="mode = 'history'">
        History
      </button>
      <select v-if="mode === 'history'" v-model.number="days" aria-label="How far back">
        <option v-for="d in HISTORY_DAYS" :key="d" :value="d">Last {{ d }} days</option>
      </select>
    </div>

    <div v-if="mode === 'history'" class="scrubber">
      <button class="play" :aria-label="playing ? 'Pause' : 'Play through the days'" @click="toggle">
        <svg v-if="playing" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" /></svg>
      </button>
      <div class="track">
        <input
          v-model.number="index"
          type="range"
          min="0"
          :max="dayList.length - 1"
          aria-label="Day"
          :aria-valuetext="label"
        />
        <div class="ends" aria-hidden="true">
          <span>{{ first }}</span>
          <span>Today</span>
        </div>
      </div>
      <output class="day">{{ label }}</output>
    </div>
  </div>
</template>

<style scoped>
.timeline {
  margin-bottom: 12px;
}

.modes {
  display: flex;
  gap: 4px;
  align-items: center;
}

.modes button {
  padding: 4px 12px;
  font-size: 13px;
  color: var(--muted);
}

.modes button.on {
  color: var(--text);
  border-color: var(--accent);
  background: rgba(124, 92, 255, 0.18);
}

.modes select {
  width: auto;
  margin-left: auto;
  padding: 4px 8px;
  font-size: 13px;
}

.scrubber {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}

.play {
  flex: none;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 50%;
}

.play svg {
  width: 16px;
  height: 16px;
  fill: currentColor;
  stroke: currentColor;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.track {
  flex: 1;
  min-width: 0;
}

.ends {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--muted);
}

.day {
  flex: none;
  min-width: 82px;
  font-size: 13px;
  font-weight: 600;
  text-align: right;
}
</style>
