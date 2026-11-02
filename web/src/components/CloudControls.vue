<script setup lang="ts">
import { computed } from 'vue'
import { GMGSI_URL, type useCloudLayer } from '../composables/useCloudLayer'

const props = defineProps<{ clouds: ReturnType<typeof useCloudLayer> }>()
const { enabled, frames, current, index, playing, loading, error } = props.clouds

const formatFrame = (t: string) =>
  new Date(t).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
const hoursAgo = (t: string) => Math.max(0, Math.round((Date.now() - Date.parse(t)) / 3_600_000))

const label = computed(() => (current.value ? formatFrame(current.value) : ''))
const ago = computed(() => (current.value ? `${hoursAgo(current.value)} h ago` : ''))
</script>

<template>
  <fieldset class="clouds">
    <legend>Clouds</legend>
    <label class="toggle">
      <input v-model="enabled" type="checkbox" />
      Show clouds, last few hours
    </label>

    <template v-if="enabled">
      <p v-if="error" class="error">Couldn't load cloud images: {{ error }}</p>
      <div v-if="frames.length" class="scrubber">
        <button class="play" :aria-label="playing ? 'Pause clouds' : 'Play clouds'" @click="playing = !playing">
          <svg v-if="playing" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg>
          <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" /></svg>
        </button>
        <div class="track">
          <input
            v-model.number="index"
            type="range"
            min="0"
            :max="frames.length - 1"
            :disabled="frames.length < 2"
            aria-label="Cloud image time"
            :aria-valuetext="label"
          />
          <div class="ends" aria-hidden="true">
            <span>{{ formatFrame(frames[0]) }}</span>
            <span>Latest</span>
          </div>
        </div>
        <span class="time" role="status">{{ label }}<small>{{ ago }}</small></span>
      </div>
      <p v-if="loading" class="meta">
        Loading cloud images{{ frames.length ? ` (${frames.length} so far)` : '' }}…
      </p>
      <p class="explain">
        Infrared satellite images, one an hour, the latest usually 1 to 3 hours old: the whiter, the colder and higher
        the cloud top. Shown at about 20 km detail.
      </p>
      <p class="credit">
        <a :href="GMGSI_URL" target="_blank" rel="noopener">NOAA/NESDIS global satellite mosaic</a> (GOES, Himawari,
        Meteosat), via nowCOAST.
      </p>
    </template>
  </fieldset>
</template>

<style scoped>
.clouds {
  margin: 0 0 12px;
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

.scrubber {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
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

.time {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  min-width: 82px;
  font-size: 13px;
  font-weight: 600;
}

.time small {
  font-size: 11px;
  font-weight: 400;
  color: var(--muted);
}

.explain,
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
