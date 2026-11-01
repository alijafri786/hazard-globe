<script setup lang="ts">
import { ref } from 'vue'
import type { useWatchArea } from '../composables/useWatchArea'
import { api } from '../services/api'
import { dropPushSubscription, getPushSubscription, pushSupport } from '../services/push'
import { HAZARD_LABELS, type AlertLevel, type HazardType } from '../types'

const props = defineProps<{ watch: ReturnType<typeof useWatchArea> }>()
const { area, subscriptionId, startPicking, useDeviceLocation, flyToArea, clear } = props.watch

const support = pushSupport()
const hazards = ref<HazardType[]>(['TC', 'FL'])
const minAlert = ref<AlertLevel>('Orange')
const busy = ref(false)
const status = ref<{ kind: 'ok' | 'error'; text: string } | null>(null)

async function run(task: () => Promise<string>) {
  busy.value = true
  status.value = null
  try {
    status.value = { kind: 'ok', text: await task() }
  } catch (err) {
    status.value = { kind: 'error', text: (err as Error).message }
  } finally {
    busy.value = false
  }
}

const locate = () => run(async () => (await useDeviceLocation(), flyToArea(), 'Centred on your location.'))

const subscribe = () =>
  run(async () => {
    if (!area.value) throw new Error('Choose an area first.')
    if (!hazards.value.length) throw new Error('Pick at least one hazard type.')
    const push = await getPushSubscription()
    const res = await api.subscribe({
      id: subscriptionId.value,
      area: area.value,
      hazards: hazards.value,
      minAlert: minAlert.value,
      push,
    })
    subscriptionId.value = res.id
    return `Watching ${area.value.label}. You'll be notified about ${minAlert.value.toLowerCase()}+ alerts.`
  })

const test = () =>
  run(async () => {
    if (!subscriptionId.value) throw new Error('Subscribe first.')
    const { result } = await api.test(subscriptionId.value)
    if (result !== 'sent') throw new Error('The server could not deliver a notification.')
    return 'Test notification sent.'
  })

const unsubscribe = () =>
  run(async () => {
    if (subscriptionId.value) await api.unsubscribe(subscriptionId.value).catch(() => undefined)
    await dropPushSubscription()
    clear()
    return 'Alerts turned off and your area removed.'
  })
</script>

<template>
  <section class="setup">
    <p v-if="support === 'needs-install'" class="note">
      On iPhone and iPad, add this site to your Home Screen (Share → Add to Home Screen) and open it from there to
      enable alerts.
    </p>
    <p v-else-if="support === 'unsupported'" class="note">This browser doesn't support push notifications.</p>

    <h3>1. Where?</h3>
    <div class="row">
      <button @click="startPicking()">Pick on globe</button>
      <button :disabled="busy" @click="locate">Use my location</button>
    </div>

    <template v-if="area">
      <label class="field">
        Name
        <input v-model.trim="area.label" type="text" maxlength="80" placeholder="e.g. Mum's house" />
      </label>
      <label class="field">
        Radius: {{ area.radiusKm }} km
        <input v-model.number="area.radiusKm" type="range" min="25" max="500" step="25" />
      </label>
      <p class="coords">
        {{ area.lat.toFixed(2) }}°, {{ area.lon.toFixed(2) }}°
        <button class="link" @click="flyToArea()">Show</button>
      </p>

      <h3>2. What?</h3>
      <div class="row">
        <label v-for="h in (['TC', 'FL'] as HazardType[])" :key="h" class="check">
          <input v-model="hazards" type="checkbox" :value="h" /> {{ HAZARD_LABELS[h] }}
        </label>
      </div>
      <label class="field">
        Minimum alert level
        <select v-model="minAlert">
          <option value="Green">Green (all events — noisy)</option>
          <option value="Orange">Orange (recommended)</option>
          <option value="Red">Red only</option>
        </select>
      </label>

      <h3>3. Notify me</h3>
      <div class="row">
        <button class="primary" :disabled="busy || support !== 'supported'" @click="subscribe">
          {{ subscriptionId ? 'Update alerts' : 'Turn on alerts' }}
        </button>
        <button v-if="subscriptionId" :disabled="busy" @click="test">Send test</button>
        <button v-if="subscriptionId" class="danger" :disabled="busy" @click="unsubscribe">Turn off</button>
      </div>
    </template>

    <p v-if="status" class="status" :class="status.kind" role="status">{{ status.text }}</p>
  </section>
</template>

<style scoped>
h3 {
  margin: 16px 0 8px;
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}

h3:first-of-type {
  margin-top: 0;
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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

.note {
  font-size: 13px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(245, 165, 36, 0.12);
  color: var(--orange);
}

.status {
  margin-top: 12px;
  font-size: 14px;
}

.status.ok {
  color: var(--green);
}

.status.error {
  color: var(--red);
}
</style>
