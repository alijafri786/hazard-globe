<script lang="ts">
import { api } from '../services/api'
import type { PlaceClimatology } from '../types'

// Answers for a place change once a year: remember them for the page's life
const answers = new Map<string, Promise<PlaceClimatology | null>>()
function lookUp(lon: number, lat: number, radiusKm: number) {
  const key = `${lon.toFixed(2)},${lat.toFixed(2)},${radiusKm}`
  let answer = answers.get(key)
  if (!answer) answers.set(key, (answer = api.climatologyNear(lon, lat, radiusKm).catch(() => null)))
  return answer
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { MONTHS } from '../composables/useClimatologyLayer'

const props = defineProps<{ lon?: number; lat?: number; radiusKm: number }>()
const result = ref<PlaceClimatology | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined
let asked = 0

// A short pause, so dragging the radius doesn't ask once per step
watch(
  () => [props.lon, props.lat, props.radiusKm] as const,
  ([lon, lat, r]) => {
    clearTimeout(timer)
    if (lon === undefined || lat === undefined) return void (result.value = null)
    const ask = ++asked
    timer = setTimeout(async () => {
      const answer = await lookUp(lon, lat, r)
      if (ask === asked) result.value = answer
    }, 500)
  },
  { immediate: true },
)
onBeforeUnmount(() => clearTimeout(timer))

/** IBTrACS names are upper case: "ANDREW" reads as "Andrew" */
const title = (name: string) =>
  name === 'NOT_NAMED' ? 'an unnamed storm' : name.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (c) => c.toUpperCase())

const text = computed(() => {
  const r = result.value
  if (!r) return null
  const since = `Since ${r.from.slice(0, 4)}`
  if (!r.storms) return `${since}, no tropical storm has passed within ${r.radiusKm} km.`
  const months = r.peakMonths.map((m) => MONTHS[m - 1])
  const when = months.length > 1 ? `, most in ${months.slice(0, -1).join(', ')} and ${months.at(-1)}` : months.length ? `, most in ${months[0]}` : ''
  const strength = r.hurricane ? `, ${r.hurricane} at hurricane strength${r.major ? ` (${r.major} major)` : ''}` : ''
  const strongest = r.strongest ? ` Strongest: ${title(r.strongest.name)} (${r.strongest.year}), ${r.strongest.kt} kt.` : ''
  return `${since}: ${r.storms} ${r.storms === 1 ? 'storm' : 'storms'} within ${r.radiusKm} km${strength}${when}.${strongest}`
})
</script>

<template>
  <small v-if="text" class="storm-history">{{ text }}</small>
</template>

<style scoped>
.storm-history {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--muted);
}
</style>
