<script setup lang="ts">
import { computed, ref } from 'vue'
import { AURORA_COLOURS, AURORA_MAX, AURORA_MIN, auroraAt, SWPC_URL, type useAuroraLayer } from '../composables/useAuroraLayer'
import type { KpPoint, WatchArea } from '../types'

const props = defineProps<{ aurora: ReturnType<typeof useAuroraLayer>; areas: WatchArea[]; live: boolean }>()
const { enabled, grid, summary, loading, error } = props.aurora

const G_WORDS = ['none', 'minor', 'moderate', 'strong', 'severe', 'extreme']
const gradient = `linear-gradient(to right, ${AURORA_COLOURS.join(', ')})`

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'
const kpText = (p: KpPoint) => `Kp ${p.kp.toFixed(1)} ${p.observed ? '' : '(forecast)'}`.trim()

/** Watch areas the aurora may be over now, most likely first */
const areaChances = computed(() => {
  const g = grid.value
  if (!g) return []
  return props.areas
    .map((a) => ({ label: a.label, pct: auroraAt(g, a.lon, a.lat) }))
    .sort((a, b) => b.pct - a.pct)
})

// ── The Kp chart: bars every 3 hours, the last day observed and the next three forecast ──
const W = 340
const H = 132
const PAD = { left: 20, right: 6, top: 14, bottom: 20 }
const plotW = W - PAD.left - PAD.right
const plotH = H - PAD.top - PAD.bottom
const y = (kp: number) => PAD.top + plotH * (1 - kp / 9)
const points = computed(() => summary.value?.kp ?? [])
const band = computed(() => plotW / Math.max(1, points.value.length))
const barW = computed(() => Math.min(24, Math.max(2, band.value - 2))) // a 2px gap between neighbours
const x = (i: number) => PAD.left + i * band.value + (band.value - barW.value) / 2

/** A column rounded 4px at its top (the data end) and square at the baseline */
function column(i: number, kp: number): string {
  const top = y(Math.max(kp, 0.05))
  const base = y(0)
  const r = Math.min(4, barW.value / 2, base - top)
  const l = x(i)
  const rt = l + barW.value
  return `M${l},${base}V${top + r}Q${l},${top} ${l + r},${top}H${rt - r}Q${rt},${top} ${rt},${top + r}V${base}Z`
}

/** Where forecast starts: the boundary between the last observed bar and the first forecast one */
const nowX = computed(() => {
  const i = points.value.findIndex((p) => !p.observed)
  return i > 0 ? PAD.left + i * band.value : null
})
/** Midnights (UTC), each labelled with its day */
const days = computed(() =>
  points.value
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.time.slice(11, 13) === '00')
    .map(({ p, i }) => ({ x: PAD.left + i * band.value, label: new Date(p.time).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }) })),
)

const hovered = ref<number | null>(null)
const readout = computed(() => {
  const p = hovered.value === null ? summary.value?.now : points.value[hovered.value]
  return p ? `${kpText(p)} · ${when(p.time)}` : ''
})
</script>

<template>
  <fieldset class="space">
    <legend>Aurora and space weather</legend>
    <label class="toggle">
      <input v-model="enabled" type="checkbox" />
      Show the aurora forecast
    </label>
    <p v-if="!live && enabled" class="meta">Live only: hidden while looking back.</p>

    <template v-if="enabled && live">
      <p v-if="error" class="error">Couldn't load space weather: {{ error }}</p>
      <p v-else-if="loading && !grid" class="meta" role="status">Loading the aurora forecast…</p>

      <div v-if="grid" class="scale" aria-label="Aurora chance colours">
        <i :style="{ background: gradient }" />
        <div class="ends">
          <span>{{ AURORA_MIN }}%</span>
          <span>{{ AURORA_MAX }}%+ chance overhead</span>
        </div>
      </div>
      <p v-if="grid" class="meta">For {{ when(grid.forecastAt) }}. Only seen at night, with a clear sky.</p>

      <ul v-if="areaChances.length" class="areas">
        <li v-for="a in areaChances" :key="a.label">
          <strong>{{ a.label }}</strong>: {{ a.pct >= 1 ? `${a.pct}% chance overhead` : 'not under the aurora now' }}
        </li>
      </ul>

      <template v-if="summary">
        <p class="kp-now" role="status">
          <span v-if="summary.now">Kp {{ summary.now.kp.toFixed(1) }} now</span>
          · Geomagnetic storm: {{ summary.scales.G ? `G${summary.scales.G} (${G_WORDS[summary.scales.G]})` : 'none' }}
        </p>

        <figure class="chart">
          <figcaption>Kp index, last day and next three (3-hourly)</figcaption>
          <p class="readout" aria-live="polite">{{ readout }}</p>
          <svg :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="Kp index by 3-hour period: the last day observed, the next three forecast">
            <defs>
              <pattern id="kp-forecast" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="4" height="4" fill="#3987e5" fill-opacity="0.25" />
                <line x1="0" y1="0" x2="0" y2="4" stroke="#3987e5" stroke-width="2" />
              </pattern>
            </defs>
            <g class="grid">
              <template v-for="k in [0, 3, 6, 9]" :key="k">
                <line :x1="PAD.left" :x2="W - PAD.right" :y1="y(k)" :y2="y(k)" />
                <text :x="PAD.left - 4" :y="y(k) + 3" text-anchor="end">{{ k }}</text>
              </template>
            </g>
            <g class="threshold">
              <line :x1="PAD.left" :x2="W - PAD.right" :y1="y(5)" :y2="y(5)" />
              <text :x="W - PAD.right" :y="y(5) - 3" text-anchor="end">G1 storm (Kp 5)</text>
            </g>
            <g
              v-for="(p, i) in points"
              :key="p.time"
              class="bar"
              tabindex="0"
              @pointerenter="hovered = i"
              @pointerleave="hovered = null"
              @focus="hovered = i"
              @blur="hovered = null"
            >
              <!-- the hit target is the whole band, taller than the mark -->
              <rect :x="PAD.left + i * band" :y="PAD.top" :width="band" :height="plotH" fill="transparent" />
              <path :d="column(i, p.kp)" :fill="p.observed ? '#3987e5' : 'url(#kp-forecast)'" />
              <title>{{ kpText(p) }}, {{ when(p.time) }}</title>
            </g>
            <g v-if="nowX !== null" class="now">
              <line :x1="nowX" :x2="nowX" :y1="PAD.top - 6" :y2="y(0)" />
              <text :x="nowX + 3" :y="PAD.top - 4">Now</text>
            </g>
            <g class="days">
              <text v-for="d in days" :key="d.x" :x="d.x + 2" :y="H - 6">{{ d.label }}</text>
            </g>
          </svg>
          <div class="key">
            <span><i class="solid" />Observed</span>
            <span><i class="hatched" />Forecast</span>
          </div>
          <details>
            <summary>Kp as a table</summary>
            <table>
              <thead>
                <tr><th>Time (UTC)</th><th>Kp</th><th /></tr>
              </thead>
              <tbody>
                <tr v-for="p in points" :key="p.time">
                  <td>{{ when(p.time) }}</td>
                  <td>{{ p.kp.toFixed(2) }}</td>
                  <td>{{ p.observed ? 'observed' : 'forecast' }}</td>
                </tr>
              </tbody>
            </table>
          </details>
        </figure>
      </template>
      <p class="credit">
        From NOAA's <a :href="SWPC_URL" target="_blank" rel="noopener">Space Weather Prediction Center</a>: the
        OVATION model's next half hour or so, and the Kp index, where 5 and over is a geomagnetic storm.
      </p>
    </template>
  </fieldset>
</template>

<style scoped>
.space {
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

.areas {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
}

.areas strong {
  font-weight: 500;
}

.kp-now {
  margin: 10px 0 0;
  font-size: 14px;
}

.chart {
  margin: 6px 0 0;
}

figcaption,
.readout {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}

.readout {
  min-height: 1.4em;
  color: var(--text);
}

svg {
  display: block;
  width: 100%;
  height: auto;
}

.grid line {
  stroke: rgba(255, 255, 255, 0.08);
  stroke-width: 1;
}

.grid text,
.days text,
.now text,
.threshold text {
  font-size: 9px;
  fill: var(--muted);
}

.threshold line {
  stroke: rgba(255, 255, 255, 0.35);
  stroke-width: 1;
}

.now line {
  stroke: rgba(255, 255, 255, 0.45);
  stroke-width: 1;
}

.bar {
  outline: none;
}

.bar:focus-visible path,
.bar:hover path {
  filter: brightness(1.3);
}

.key {
  display: flex;
  gap: 14px;
  font-size: 12px;
  color: var(--muted);
}

.key i {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 4px;
  border-radius: 2px;
  vertical-align: -1px;
}

.key .solid {
  background: #3987e5;
}

.key .hatched {
  background: repeating-linear-gradient(45deg, #3987e5 0 2px, rgba(57, 135, 229, 0.25) 2px 4px);
}

details {
  margin-top: 6px;
  font-size: 12px;
  color: var(--muted);
}

table {
  width: 100%;
  margin-top: 4px;
  border-collapse: collapse;
}

th,
td {
  padding: 2px 4px;
  text-align: left;
  font-weight: 400;
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
