import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { HazardEvent } from '../types'

export type TimelineMode = 'live' | 'history'
/** The ranges the server offers, each ending today */
export const HISTORY_DAYS = [7, 30, 90] as const
export type HistoryDays = (typeof HISTORY_DAYS)[number]

const DAY = 86_400_000
const startOfUtcDay = (t: number) => Math.floor(t / DAY) * DAY

/** GDACS dates carry no zone, e.g. "2026-10-07T15:00:00", and are UTC. */
export function parseGdacsDate(s?: string): number | null {
  if (!s) return null
  const t = Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(s) ? s : `${s}Z`)
  return Number.isFinite(t) ? t : null
}

export const formatDay = (t: number) =>
  new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

/** Live events, or a day-by-day look back over the last 7, 30 or 90 days (UTC days, as GDACS uses). */
export function useTimeline() {
  const mode = ref<TimelineMode>('live')
  const days = ref<HistoryDays>(30)
  const today = ref(startOfUtcDay(Date.now()))
  const dayList = computed(() => Array.from({ length: days.value }, (_, i) => today.value - (days.value - 1 - i) * DAY))
  /** Position of the selected day in dayList: starts on today */
  const index = ref(days.value - 1)
  const day = computed(() => dayList.value[Math.min(index.value, dayList.value.length - 1)])
  const playing = ref(false)
  let timer: ReturnType<typeof setInterval> | undefined

  function pause() {
    playing.value = false
    clearInterval(timer)
  }

  function play() {
    if (index.value >= days.value - 1) index.value = 0
    playing.value = true
    clearInterval(timer)
    // About 15 seconds end to end, but never a blur nor a crawl
    const step = Math.max(250, Math.min(800, 15_000 / days.value))
    timer = setInterval(() => (index.value >= days.value - 1 ? pause() : index.value++), step)
  }

  const toggle = () => (playing.value ? pause() : play())

  /** Whether the event was active at any time on the selected day. Everything shows when live. */
  function shows(e: HazardEvent): boolean {
    if (mode.value === 'live') return true
    const from = parseGdacsDate(e.properties.fromdate) ?? -Infinity
    const to = parseGdacsDate(e.properties.todate) ?? Infinity // no end yet: still going
    return from < day.value + DAY && to >= day.value
  }

  watch(days, () => {
    pause()
    index.value = days.value - 1
  })
  watch(mode, (m) => {
    pause()
    today.value = startOfUtcDay(Date.now()) // a tab left open overnight
    if (m === 'history') index.value = days.value - 1
  })
  onBeforeUnmount(pause)

  return { mode, days, dayList, index, day, playing, play, pause, toggle, shows }
}
