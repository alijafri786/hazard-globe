<script setup lang="ts">
import { computed } from 'vue'
import type { useWatchAreas } from '../composables/useWatchAreas'
import { ALERT_HAZARDS, alertHazardLabel } from '../hazards'
import AreaStormHistory from './AreaStormHistory.vue'

const props = defineProps<{ watch: ReturnType<typeof useWatchAreas>; busy: boolean }>()
const emit = defineEmits<{ save: []; locate: [] }>()
const { draft, editingIndex, startPicking, cancelEdit, flyTo } = props.watch

// Fire alerts need the server's FIRMS key: offered only when it has one
const hazards = computed(() => ALERT_HAZARDS.filter((h) => h !== 'HS' || props.watch.serverChannels.value?.fires))

const hasCentre = computed(() => draft.value?.lon !== undefined && draft.value?.lat !== undefined)
</script>

<template>
  <form v-if="draft" class="editor" @submit.prevent="emit('save')">
    <div class="row">
      <button type="button" @click="startPicking()">Pick on globe</button>
      <button type="button" :disabled="busy" @click="emit('locate')">Use my location</button>
    </div>
    <p class="coords">
      <template v-if="hasCentre">
        {{ draft.lat!.toFixed(2) }}°, {{ draft.lon!.toFixed(2) }}°
        <button type="button" class="link" @click="flyTo(draft)">Show</button>
      </template>
      <template v-else>Choose a centre for this area.</template>
    </p>

    <label class="field">
      Name
      <input v-model="draft.label" type="text" maxlength="80" placeholder="e.g. Mum's house" />
    </label>
    <label class="field">
      Radius: {{ draft.radiusKm }} km
      <input v-model.number="draft.radiusKm" type="range" min="25" max="500" step="25" />
      <AreaStormHistory v-if="draft.hazards.includes('TC')" :lon="draft.lon" :lat="draft.lat" :radius-km="draft.radiusKm" />
    </label>

    <fieldset class="row">
      <legend>Hazards</legend>
      <label v-for="h in hazards" :key="h" class="check">
        <input v-model="draft.hazards" type="checkbox" :value="h" /> {{ alertHazardLabel(h) }}
      </label>
    </fieldset>
    <p v-if="draft.hazards.includes('TS')" class="hint">
      Tsunami messages come from NOAA's Pacific and US centres, for earthquakes within 1,000 km of this area. They
      cover the Pacific, the Caribbean and North American coasts: elsewhere, follow your own country's centre.
    </p>
    <p v-if="draft.hazards.includes('EQ')" class="hint">
      Earthquake alerts come after the shaking, when it was strong near this area: a prompt to check on people.
    </p>
    <label v-if="draft.hazards.includes('TC')" class="check cone">
      <input v-model="draft.forecastAlerts" type="checkbox" />
      <span>
        Also alert me when a cyclone's forecast cone reaches this area
        <small>Earlier warning, but the storm may still miss: the cone is where its centre is likely to go.</small>
      </span>
    </label>
    <label class="field">
      Minimum alert level
      <select v-model="draft.minAlert">
        <option value="Green">Green (all events — noisy)</option>
        <option value="Orange">Orange (recommended)</option>
        <option value="Red">Red only</option>
      </select>
    </label>

    <div class="row actions">
      <button type="submit" class="primary" :disabled="busy || !hasCentre || !draft.hazards.length">
        {{ editingIndex === null ? 'Add area' : 'Save area' }}
      </button>
      <button type="button" :disabled="busy" @click="cancelEdit()">Cancel</button>
    </div>
  </form>
</template>

<style scoped>
.editor {
  margin: 8px 0;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

fieldset {
  margin: 12px 0 0;
  padding: 0;
  border: none;
}

legend {
  width: 100%;
  margin-bottom: 6px;
  padding: 0;
  font-size: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
  font-size: 14px;
}

.check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
}

.cone {
  align-items: flex-start;
  margin-top: 12px;
}

.cone input {
  margin-top: 3px;
}

.cone small {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--muted);
}

.hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--muted);
}

.coords {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--muted);
}

.link {
  border: none;
  background: none;
  padding: 0 4px;
  color: var(--accent);
  text-decoration: underline;
}

.actions {
  margin-top: 14px;
}
</style>
