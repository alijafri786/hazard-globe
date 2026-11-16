<script setup lang="ts">
import { DART_COLOUR, MESSAGE_STYLE, TSUNAMI_URL, type useTsunamiLayer } from '../composables/useTsunamiLayer'
import type { useTimeline } from '../composables/useTimeline'

const props = defineProps<{ tsunami: ReturnType<typeof useTsunamiLayer>; timeline: ReturnType<typeof useTimeline> }>()
const { enabled, buoysOn, messages, error } = props.tsunami
const { mode } = props.timeline

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'
const kinds = [MESSAGE_STYLE.warning, MESSAGE_STYLE.advisory, MESSAGE_STYLE.information]
</script>

<template>
  <fieldset class="tsunami">
    <legend>Tsunamis (NOAA)</legend>
    <label class="toggle">
      <input v-model="enabled" type="checkbox" />
      Tsunami messages, the last day
    </label>
    <label class="toggle">
      <input v-model="buoysOn" type="checkbox" />
      DART buoys on the ocean floor
    </label>
    <p v-if="mode === 'history' && (enabled || buoysOn)" class="meta">Live only: hidden while looking back.</p>

    <template v-if="enabled && mode === 'live'">
      <ul class="key" aria-label="Tsunami message colours">
        <li v-for="k in kinds" :key="k.label"><i :style="{ borderColor: k.colour }" />{{ k.label }}</li>
      </ul>
      <p v-if="error" class="error">Couldn't load tsunami messages: {{ error }}</p>
      <p v-else-if="!messages.length" class="meta" role="status">No messages in the last day.</p>
      <ul v-else class="messages">
        <li v-for="m in messages" :key="m.id">
          <i :style="{ borderColor: MESSAGE_STYLE[m.type].colour }" aria-hidden="true" />
          <span>
            <strong>{{ MESSAGE_STYLE[m.type].label }}</strong>: {{ m.region }}
            <small>{{ m.magnitude ? `M${m.magnitude} · ` : '' }}{{ when(m.issuedAt) }} · {{ m.centre }}</small>
          </span>
        </li>
      </ul>
    </template>
    <p v-if="buoysOn && mode === 'live'" class="meta">
      <i class="buoy" :style="{ background: DART_COLOUR }" aria-hidden="true" /> Click a buoy for its last day of water
      height.
    </p>
    <p v-if="(enabled || buoysOn) && mode === 'live'" class="credit">
      From NOAA's <a :href="TSUNAMI_URL" target="_blank" rel="noopener">Pacific and National Tsunami Warning Centers</a>,
      which cover the Pacific, the Caribbean and North American coasts. Japan, the Indian Ocean and Europe have their own.
    </p>
  </fieldset>
</template>

<style scoped>
.tsunami {
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

.key,
.messages {
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
  font-size: 12px;
}

.key {
  display: flex;
  gap: 12px;
  color: var(--muted);
}

.key i,
.messages i {
  display: inline-block;
  flex: none;
  width: 10px;
  height: 10px;
  margin-right: 4px;
  border: 2px solid;
  border-radius: 50%;
}

.messages li {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin-top: 4px;
}

.messages strong {
  font-weight: 600;
}

.messages small {
  display: block;
  color: var(--muted);
}

.buoy {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
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
