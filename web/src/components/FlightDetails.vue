<script setup lang="ts">
import { computed } from 'vue'
import type { useFlightDetails } from '../composables/useFlightDetails'
import type { useFlightLayer } from '../composables/useFlightLayer'
import { ADSBDB_URL, type Airport } from '../services/aircraft'

const props = defineProps<{
  flights: ReturnType<typeof useFlightLayer>
  card: ReturnType<typeof useFlightDetails>
}>()
const { details, progress, close } = props.card

const flight = computed(() => {
  void props.flights.moved.value // follow each new snapshot
  return details.value ? props.flights.flightOf(details.value.icao24) : undefined
})

const km = (n: number) => `${Math.round(n).toLocaleString()} km`
const place = (a: Airport) => a.city || a.name

function duration(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return h ? `${h} h ${m} min` : `${m} min`
}

const live = computed(() => {
  const f = flight.value
  if (!f) return []
  const [, , country, , , altitude, velocity, track, climb] = f
  return [
    ['Altitude', `${altitude.toLocaleString()} m (${Math.round(altitude * 3.28084).toLocaleString()} ft)`],
    ['Speed', velocity != null ? `${Math.round(velocity * 3.6)} km/h (${Math.round(velocity * 1.94384)} kt)` : ''],
    ['Heading', track != null ? `${track}°` : ''],
    ['Climb rate', climb != null ? `${climb > 0 ? '+' : ''}${climb} m/s` : ''],
    ['Registered in', country],
  ].filter(([, v]) => v)
})

const trailNote = computed(() => {
  const d = details.value
  if (!d) return ''
  if (d.track === undefined) return 'Loading the path it has flown…'
  if (d.track?.length) return 'The coloured line is the path it has flown, from OpenSky.'
  if (progress.value?.onRoute) return 'The faint line from where it took off is a straight guess, not its actual path.'
  return ''
})
</script>

<template>
  <article v-if="details" class="flight-card" aria-label="Selected flight">
    <header>
      <div>
        <strong class="callsign">{{ details.callsign || details.icao24.toUpperCase() }}</strong>
        <span v-if="details.route?.airline" class="airline">{{ details.route.airline }}</span>
      </div>
      <button class="close" aria-label="Close flight details" @click="close()">×</button>
    </header>

    <p v-if="details.route === undefined" class="meta">Looking up the route…</p>
    <section v-else-if="details.route" class="route">
      <div class="ends">
        <div>
          <b>{{ details.route.origin.iata || details.route.origin.icao }}</b>
          <small>{{ place(details.route.origin) }}</small>
        </div>
        <span class="arrow" aria-hidden="true">→</span>
        <div class="to">
          <b>{{ details.route.destination.iata || details.route.destination.icao }}</b>
          <small>{{ place(details.route.destination) }}</small>
        </div>
      </div>
      <template v-if="progress?.onRoute">
        <div
          class="bar"
          role="progressbar"
          aria-label="Distance flown"
          :aria-valuenow="Math.round(progress.fraction * 100)"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <i :style="{ width: `${progress.fraction * 100}%` }" />
        </div>
        <p class="meta">
          {{ km(progress.flownKm) }} flown · {{ km(progress.toGoKm) }} to go<template v-if="progress.minutesLeft">
            · about {{ duration(progress.minutesLeft) }} left</template
          >
        </p>
      </template>
      <p v-else-if="progress" class="note">
        It isn't flying between these airports, so this route, from a community database, is probably out of date.
      </p>
    </section>
    <p v-else class="meta">Route not known.</p>

    <dl>
      <template v-if="details.aircraft">
        <dt>Aircraft</dt>
        <dd>{{ [details.aircraft.manufacturer, details.aircraft.type].filter(Boolean).join(' ') }}</dd>
        <dt>Registration</dt>
        <dd>{{ details.aircraft.registration }}</dd>
        <template v-if="details.aircraft.owner">
          <dt>Operator</dt>
          <dd>{{ details.aircraft.owner }}</dd>
        </template>
      </template>
      <template v-for="[k, v] in live" :key="k">
        <dt>{{ k }}</dt>
        <dd>{{ v }}</dd>
      </template>
      <dt>Transponder</dt>
      <dd>{{ details.icao24.toUpperCase() }}</dd>
    </dl>
    <p v-if="!flight" class="note">No longer in the latest report: it may have landed.</p>

    <p v-if="trailNote" class="meta">{{ trailNote }}</p>
    <p class="source">
      Aircraft and route from <a :href="ADSBDB_URL" target="_blank" rel="noopener">adsbdb</a> (community data, can be
      wrong);
      <a :href="`https://map.opensky-network.org/?icao=${details.icao24}`" target="_blank" rel="noopener"
        >live track on OpenSky ↗</a
      >
    </p>
  </article>
</template>

<style scoped>
.flight-card {
  margin-bottom: 14px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
}

header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}

.callsign {
  display: block;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.airline {
  font-size: 13px;
  color: var(--muted);
}

.close {
  flex: none;
  padding: 0 8px;
  border: none;
  background: none;
  font-size: 18px;
  line-height: 1.2;
  color: var(--muted);
}

.route {
  margin: 12px 0;
}

.ends {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ends div {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.ends .to {
  align-items: flex-end;
  text-align: right;
}

.ends b {
  font-size: 22px;
  font-weight: 600;
}

.ends small {
  font-size: 12px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.arrow {
  color: var(--muted);
  font-size: 18px;
}

.bar {
  height: 6px;
  margin: 10px 0 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
}

.bar i {
  display: block;
  height: 100%;
  background: var(--accent);
}

dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  margin: 12px 0 0;
  font-size: 13px;
}

dt {
  color: var(--muted);
}

dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.meta,
.note,
.source {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
}

.note {
  color: var(--orange);
}

.source a {
  color: var(--text);
}
</style>
