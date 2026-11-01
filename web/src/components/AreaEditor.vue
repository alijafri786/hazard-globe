<script setup lang="ts">
import { computed } from 'vue'
import type { useWatchAreas } from '../composables/useWatchAreas'
import { HAZARD_LABELS, type HazardType } from '../types'

const props = defineProps<{ watch: ReturnType<typeof useWatchAreas>; busy: boolean }>()
const emit = defineEmits<{ save: []; locate: [] }>()
const { draft, editingIndex, startPicking, cancelEdit, flyTo } = props.watch

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
    </label>

    <fieldset class="row">
      <legend>Hazards</legend>
      <label v-for="h in (['TC', 'FL'] as HazardType[])" :key="h" class="check">
        <input v-model="draft.hazards" type="checkbox" :value="h" /> {{ HAZARD_LABELS[h] }}
      </label>
    </fieldset>
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
