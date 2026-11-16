<script setup lang="ts">
import { computed } from 'vue'
import type { useGibsLayers } from '../composables/useGibsLayers'
import { formatDay, parseGdacsDate } from '../composables/useTimeline'
import { GIBS, GIBS_IDS, GIBS_URL, type GibsId } from '../layers/gibs'

const props = defineProps<{ gibs: ReturnType<typeof useGibsLayers>; tab: 'weather' | 'space' }>()
const { on, shownDay, error, loading } = props.gibs

const ids = GIBS_IDS.filter((id) => GIBS[id].tab === props.tab)
const sea = ids.filter((id) => GIBS[id].sea)
const others = ids.filter((id) => !GIBS[id].sea)

/** The sea overlay chosen, as one choice of several */
const seaChoice = computed<GibsId | 'none'>({
  get: () => sea.find((id) => on.value[id]) ?? 'none',
  set: (choice) => {
    for (const id of sea) on.value[id] = id === choice
  },
})

const active = computed(() => ids.filter((id) => on.value[id]))
const dayOf = (id: GibsId) => {
  const t = parseGdacsDate(shownDay.value[id])
  return t === null ? null : formatDay(t)
}
const gradient = (id: GibsId) => `linear-gradient(to right, ${GIBS[id].legend.colours.join(', ')})`
</script>

<template>
  <fieldset class="gibs">
    <legend>{{ tab === 'weather' ? 'From satellites' : 'The sea' }}</legend>
    <label v-for="id in others" :key="id" class="toggle">
      <input v-model="on[id]" type="checkbox" />
      {{ GIBS[id].label }}
    </label>
    <template v-if="sea.length">
      <label class="toggle">
        <input v-model="seaChoice" type="radio" value="none" name="sea-overlay" />
        No sea overlay
      </label>
      <label v-for="id in sea" :key="id" class="toggle">
        <input v-model="seaChoice" type="radio" :value="id" name="sea-overlay" />
        {{ GIBS[id].label }}
      </label>
    </template>

    <div v-for="id in active" :key="id" class="active">
      <div class="scale" :aria-label="`${GIBS[id].label} colours`">
        <i :style="{ background: gradient(id) }" />
        <div class="ends">
          <span v-for="e in GIBS[id].legend.ends" :key="e">{{ e }}</span>
        </div>
        <small class="unit">{{ GIBS[id].legend.title }}</small>
      </div>
      <p v-if="error[id]" class="error">{{ error[id] }}</p>
      <p v-else class="meta" role="status">
        <span v-if="loading[id] && !shownDay[id]">Loading…</span>
        <span v-else-if="dayOf(id)">{{ GIBS[id].label }}: {{ dayOf(id) }}</span>
      </p>
      <p class="credit">{{ GIBS[id].about }}</p>
    </div>
    <p v-if="active.length" class="credit">
      From <a :href="GIBS_URL" target="_blank" rel="noopener">NASA GIBS</a>, usually a day behind.
    </p>
  </fieldset>
</template>

<style scoped>
.gibs {
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

.active {
  margin-top: 8px;
}

.scale i {
  display: block;
  height: 8px;
  border-radius: 4px;
}

.ends {
  display: flex;
  justify-content: space-between;
  margin-top: 2px;
  font-size: 11px;
  color: var(--muted);
}

.unit {
  font-size: 11px;
  color: var(--muted);
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
</style>
