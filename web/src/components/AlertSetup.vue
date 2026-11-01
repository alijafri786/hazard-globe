<script setup lang="ts">
import { computed, ref } from 'vue'
import type { useWatchAreas } from '../composables/useWatchAreas'
import { api } from '../services/api'
import { dropPushSubscription, getPushSubscription, pushSupport } from '../services/push'
import { MAX_AREAS, type WatchArea } from '../types'
import AreaEditor from './AreaEditor.vue'

const props = defineProps<{ watch: ReturnType<typeof useWatchAreas> }>()
const { areas, subscriptionId, draft, editingIndex, expired, startAdd, startEdit, cancelEdit, withDraft, without } =
  props.watch

const support = pushSupport()
const busy = ref(false)
const status = ref<{ kind: 'ok' | 'error'; text: string } | null>(null)
const subscribed = computed(() => Boolean(subscriptionId.value))

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

function summary(a: WatchArea): string {
  const hazards = a.hazards.length === 2 ? 'Storms and floods' : a.hazards[0] === 'TC' ? 'Storms' : 'Floods'
  const level = { Green: 'all levels', Orange: 'orange and red', Red: 'red only' }[a.minAlert]
  return `${a.radiusKm} km · ${hazards}, ${level}`
}

/** Saves a new list: on this device until alerts are on, then on the server, which assigns ids. */
async function apply(next: WatchArea[]) {
  if (!subscriptionId.value) {
    areas.value = next
    return
  }
  const view = await api.subscribe({ id: subscriptionId.value, areas: next, push: await getPushSubscription() })
  subscriptionId.value = view.id
  areas.value = view.areas
}

const locate = () =>
  run(async () => {
    await props.watch.useDeviceLocation()
    if (draft.value) props.watch.flyTo(draft.value)
    return 'Centred on your location.'
  })

const saveDraft = () =>
  run(async () => {
    const next = withDraft()
    if (!next) throw new Error('Choose a centre for this area first.')
    const i = editingIndex.value ?? next.length - 1
    const verb = editingIndex.value === null ? 'Added' : 'Saved'
    await apply(next)
    cancelEdit()
    return `${verb} ${next[i].label}.${subscribed.value ? ' Alerts updated.' : ''}`
  })

const remove = (i: number) =>
  run(async () => {
    const { label } = areas.value[i]
    await apply(without(i))
    return `Removed ${label}.`
  })

const subscribe = () =>
  run(async () => {
    if (!areas.value.length) throw new Error('Add an area first.')
    const push = await getPushSubscription()
    const view = await api.subscribe({ id: subscriptionId.value, areas: areas.value, push })
    subscriptionId.value = view.id
    areas.value = view.areas
    expired.value = false
    return 'Alerts turned on. Send a test to check they arrive.'
  })

const test = () =>
  run(async () => {
    if (!subscriptionId.value) throw new Error('Turn on alerts first.')
    const { result } = await api.test(subscriptionId.value)
    if (result !== 'sent') throw new Error('The server could not deliver a notification.')
    return 'Test notification sent.'
  })

const unsubscribe = () =>
  run(async () => {
    if (subscriptionId.value) await api.unsubscribe(subscriptionId.value).catch(() => undefined)
    await dropPushSubscription()
    subscriptionId.value = undefined
    areas.value = areas.value.map(({ id: _, ...a }) => a) // server ids mean nothing once it has forgotten us
    return 'Alerts turned off. Your areas are kept on this device.'
  })
</script>

<template>
  <section class="setup">
    <p v-if="support === 'needs-install'" class="note">
      On iPhone and iPad, add this site to your Home Screen (Share → Add to Home Screen) and open it from there to
      enable alerts.
    </p>
    <p v-else-if="support === 'unsupported'" class="note">This browser doesn't support push notifications.</p>
    <p v-if="expired" class="note">Your alerts were switched off on the server. Turn them on again to keep watching.</p>

    <h3>Watch areas</h3>
    <p v-if="!areas.length && !draft" class="empty">Add the places you care about: home, family, a site you manage.</p>

    <ul class="areas">
      <li v-for="(a, i) in areas" :key="a.id ?? `local-${i}`">
        <AreaEditor v-if="draft && editingIndex === i" :watch="watch" :busy="busy" @save="saveDraft" @locate="locate" />
        <div v-else class="area">
          <button class="area-main" @click="watch.flyTo(a)">
            <strong>{{ a.label }}</strong>
            <small>{{ summary(a) }}</small>
          </button>
          <button class="link" :disabled="busy || !!draft" @click="startEdit(i)">Edit</button>
          <button
            class="link danger"
            :disabled="busy || !!draft || (subscribed && areas.length === 1)"
            :title="subscribed && areas.length === 1 ? 'Turn off alerts to remove your last area' : undefined"
            @click="remove(i)"
          >
            Remove
          </button>
        </div>
      </li>
    </ul>

    <AreaEditor
      v-if="draft && editingIndex === null"
      :watch="watch"
      :busy="busy"
      @save="saveDraft"
      @locate="locate"
    />
    <button v-else-if="!draft && areas.length < MAX_AREAS" :disabled="busy" @click="startAdd()">+ Add area</button>

    <h3>Notifications</h3>
    <p v-if="subscribed" class="on">
      Alerts are on for {{ areas.length === 1 ? areas[0].label : `${areas.length} areas` }}.
    </p>
    <div class="row">
      <button
        v-if="!subscribed"
        class="primary"
        :disabled="busy || !!draft || !areas.length || support !== 'supported'"
        @click="subscribe"
      >
        Turn on alerts
      </button>
      <template v-else>
        <button :disabled="busy" @click="test">Send test</button>
        <button class="danger" :disabled="busy" @click="unsubscribe">Turn off</button>
      </template>
    </div>

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

.areas {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
}

.area {
  display: flex;
  align-items: center;
  gap: 4px;
  border-bottom: 1px solid var(--line);
}

.area-main {
  all: unset;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 0;
  cursor: pointer;
}

.area-main strong {
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.area-main small {
  font-size: 12px;
  color: var(--muted);
}

.link {
  border: none;
  background: none;
  padding: 4px 6px;
  color: var(--accent);
  text-decoration: underline;
}

.link.danger {
  color: var(--red);
}

.link:disabled {
  opacity: 0.4;
}

.empty,
.on {
  font-size: 14px;
  color: var(--muted);
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
