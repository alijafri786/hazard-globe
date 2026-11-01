<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { useWatchAreas } from '../composables/useWatchAreas'
import { api } from '../services/api'
import { dropPushSubscription, getPushSubscription, type PushSupport } from '../services/push'
import type { ChannelView, SubscriptionView } from '../types'

const props = defineProps<{
  watch: ReturnType<typeof useWatchAreas>
  busy: boolean
  support: PushSupport
  run: (task: () => Promise<string>) => Promise<void>
}>()
const { areas, subscriptionId, channels, serverChannels, draft, applyView, forget, refresh } = props.watch

const NAMES: Record<ChannelView['kind'], string> = { push: 'this browser', email: 'email', telegram: 'Telegram' }
const list = (kinds: ChannelView['kind'][]) => kinds.map((k) => NAMES[k]).join(' and ')

const offers = computed(() => serverChannels.value ?? { push: true, email: false, telegram: null })
const canPush = computed(() => offers.value.push && props.support === 'supported')
const subscribed = computed(() => Boolean(subscriptionId.value))
const push = computed(() => channels.value.some((c) => c.kind === 'push'))
const email = computed(() => channels.value.find((c): c is Extract<ChannelView, { kind: 'email' }> => c.kind === 'email'))
const telegram = computed(() =>
  channels.value.find((c): c is Extract<ChannelView, { kind: 'telegram' }> => c.kind === 'telegram'),
)
const reachable = computed(() => push.value || Boolean(email.value?.verified) || Boolean(telegram.value?.linked))
const watching = computed(() => (areas.value.length === 1 ? areas.value[0].label : `${areas.value.length} areas`))

// Choices before alerts are on
const wantPush = ref(true)
const wantEmail = ref(false)
const wantTelegram = ref(false)
const emailInput = ref('')

/** The bot link while we wait for the user to open it */
const telegramLink = ref<string | null>(null)
let waiting: ReturnType<typeof setInterval> | undefined

function stopWaiting() {
  clearInterval(waiting)
  waiting = undefined
}

async function linkTelegram(id: string) {
  telegramLink.value = (await api.connectTelegram(id)).url
  stopWaiting()
  const until = Date.now() + 15 * 60_000 // the link's lifetime
  waiting = setInterval(() => {
    if (Date.now() > until) {
      telegramLink.value = null
      return stopWaiting()
    }
    void refresh()
  }, 3000)
}

watch(
  () => telegram.value?.linked,
  (linked) => {
    if (!linked) return
    telegramLink.value = null
    stopWaiting()
  },
)
onBeforeUnmount(stopWaiting)

function confirmationNote(result: SubscriptionView['emailConfirmation']): string {
  if (result === 'sent') return ' Check your inbox to confirm your email address.'
  if (result === 'limited') return ' Too many confirmation emails to that address lately: try Resend later.'
  if (result === 'failed') return " The confirmation email couldn't be sent: try Resend."
  return ''
}

/** Saves channel changes for the current areas. */
const save = async (changes: { push?: PushSubscriptionJSON | null; email?: string | null }) => {
  const view = await api.subscribe({ id: subscriptionId.value, areas: areas.value, ...changes })
  applyView(view)
  return view
}

const turnOn = () =>
  props.run(async () => {
    if (!areas.value.length) throw new Error('Add an area first.')
    const usePush = canPush.value && wantPush.value
    const useEmail = offers.value.email && wantEmail.value
    const useTelegram = Boolean(offers.value.telegram) && wantTelegram.value
    if (!usePush && !useEmail && !useTelegram) throw new Error('Choose at least one way to be notified.')
    if (useEmail && !emailInput.value) throw new Error('Enter your email address.')

    const view = await save({
      ...(usePush && { push: await getPushSubscription() }),
      ...(useEmail && { email: emailInput.value }),
    })
    if (useTelegram) await linkTelegram(view.id)
    return (
      'Alerts turned on.' +
      confirmationNote(view.emailConfirmation) +
      (useTelegram ? ' Open Telegram to finish connecting.' : '') +
      (usePush ? ' Send a test to check they arrive.' : '')
    )
  })

const setPush = (on: boolean) =>
  props.run(async () => {
    if (on) {
      await save({ push: await getPushSubscription() })
      return 'Notifications are on in this browser.'
    }
    await save({ push: null })
    await dropPushSubscription()
    return 'Notifications are off in this browser.'
  })

const saveEmail = () =>
  props.run(async () => {
    const view = await save({ email: emailInput.value })
    return `Email saved.${confirmationNote(view.emailConfirmation)}`
  })

const removeEmail = () =>
  props.run(async () => {
    await save({ email: null })
    return 'Email removed.'
  })

const resend = () =>
  props.run(async () => {
    const { emailConfirmation } = await api.resendEmail(subscriptionId.value!)
    return confirmationNote(emailConfirmation).trim()
  })

const connect = () =>
  props.run(async () => {
    await linkTelegram(subscriptionId.value!)
    return 'Open Telegram to finish connecting.'
  })

const disconnect = () =>
  props.run(async () => {
    await api.disconnectTelegram(subscriptionId.value!)
    await refresh()
    return 'Telegram disconnected.'
  })

const test = () =>
  props.run(async () => {
    const { channels: results } = await api.test(subscriptionId.value!)
    const kinds = Object.keys(results) as ChannelView['kind'][]
    const ok = kinds.filter((k) => results[k] === 'sent')
    const bad = kinds.filter((k) => results[k] !== 'sent')
    if (!ok.length) throw new Error(bad.length ? `Couldn't reach ${list(bad)}.` : 'There is nowhere to send to yet.')
    return `Test sent to ${list(ok)}.${bad.length ? ` Couldn't reach ${list(bad)}.` : ''}`
  })

const turnOff = () =>
  props.run(async () => {
    if (subscriptionId.value) await api.unsubscribe(subscriptionId.value).catch(() => undefined)
    await dropPushSubscription()
    stopWaiting()
    telegramLink.value = null
    forget()
    return 'Alerts turned off. Your areas are kept on this device.'
  })
</script>

<template>
  <h3>Notifications</h3>

  <template v-if="!subscribed">
    <p class="hint">How should we reach you?</p>
    <div class="choices">
      <label v-if="offers.push" class="check">
        <input v-model="wantPush" type="checkbox" :disabled="!canPush" /> Notifications in this browser
      </label>
      <template v-if="offers.email">
        <label class="check"><input v-model="wantEmail" type="checkbox" /> Email</label>
        <input
          v-if="wantEmail"
          v-model.trim="emailInput"
          type="email"
          autocomplete="email"
          placeholder="you@example.com"
          aria-label="Email address"
        />
      </template>
      <label v-if="offers.telegram" class="check"><input v-model="wantTelegram" type="checkbox" /> Telegram</label>
    </div>
    <div class="row">
      <button class="primary" :disabled="busy || !!draft || !areas.length" @click="turnOn">Turn on alerts</button>
    </div>
  </template>

  <template v-else>
    <p class="hint">Alerts are on for {{ watching }}.</p>
    <ul class="channels">
      <li v-if="offers.push || push">
        <span class="what">
          <strong>This browser</strong>
          <small>{{ push ? 'On' : canPush ? 'Off' : 'Not available here' }}</small>
        </span>
        <button v-if="push" class="link" :disabled="busy" @click="setPush(false)">Turn off</button>
        <button v-else-if="canPush" class="link" :disabled="busy" @click="setPush(true)">Turn on</button>
      </li>

      <li v-if="offers.email || email">
        <template v-if="email">
          <span class="what">
            <strong>Email</strong>
            <small class="address">{{ email.address }}</small>
            <small>{{ email.verified ? 'Confirmed' : 'Waiting for you to confirm' }}</small>
          </span>
          <button v-if="!email.verified" class="link" :disabled="busy" @click="resend">Resend</button>
          <button class="link danger" :disabled="busy" @click="removeEmail">Remove</button>
        </template>
        <form v-else class="add-email" @submit.prevent="saveEmail">
          <input
            v-model.trim="emailInput"
            type="email"
            required
            autocomplete="email"
            placeholder="you@example.com"
            aria-label="Email address"
          />
          <button :disabled="busy">Add email</button>
        </form>
      </li>

      <li v-if="offers.telegram || telegram">
        <span class="what">
          <strong>Telegram</strong>
          <small>{{ telegram?.linked ? 'Connected' : telegramLink ? 'Waiting for you to open the bot' : 'Not connected' }}</small>
        </span>
        <a v-if="telegramLink && !telegram?.linked" class="link" :href="telegramLink" target="_blank" rel="noopener">
          Open Telegram
        </a>
        <button v-if="telegram?.linked" class="link danger" :disabled="busy" @click="disconnect">Disconnect</button>
        <button v-else-if="!telegramLink" class="link" :disabled="busy" @click="connect">Connect</button>
      </li>
    </ul>

    <p v-if="!reachable" class="note">
      Nowhere to send alerts yet: confirm your email, connect Telegram or turn on notifications in this browser.
    </p>
    <div class="row">
      <button :disabled="busy || !reachable" @click="test">Send test</button>
      <button class="danger" :disabled="busy" @click="turnOff">Turn off all alerts</button>
    </div>
  </template>
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

.hint {
  margin: 0 0 8px;
  font-size: 14px;
  color: var(--muted);
}

.choices {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.channels {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
}

.channels li {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 44px;
  border-bottom: 1px solid var(--line);
}

.what {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 0;
}

.what strong {
  font-size: 14px;
}

.what small {
  font-size: 12px;
  color: var(--muted);
}

.what .address {
  overflow-wrap: anywhere;
}

.add-email {
  flex: 1;
  display: flex;
  gap: 8px;
  padding: 6px 0;
}

.add-email input {
  flex: 1;
  min-width: 0;
}

.link {
  border: none;
  background: none;
  padding: 4px 6px;
  font-size: 14px;
  color: var(--accent);
  text-decoration: underline;
  white-space: nowrap;
}

.link.danger {
  color: var(--red);
}

.note {
  font-size: 13px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(245, 165, 36, 0.12);
  color: var(--orange);
}
</style>
