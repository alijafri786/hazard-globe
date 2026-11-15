import { ImageryLayer, type Viewer } from 'cesium'
import { onBeforeUnmount, ref, watch, type ShallowRef } from 'vue'
import { GIBS, GIBS_IDS, type GibsId } from '../layers/gibs'
import { dayOnOrBefore, gibsProvider, latestDay } from '../services/gibs'
import type { useTimeline } from './useTimeline'

const OPACITY = 0.75
// While History plays, days go by every half second or so: wait till it stops on one before fetching tiles
const SETTLE_MS = 600

/**
 * NASA GIBS overlays: rainfall, and one of sea temperature, its anomaly or sea ice. Browsers fetch the
 * tiles straight from GIBS. Live shows GIBS's newest day; History shows the day looked at (or one of the
 * two before it, when GIBS lacks that day), once the timeline stops on it.
 */
export function useGibsLayers(viewer: ShallowRef<Viewer | null>, timeline: ReturnType<typeof useTimeline>) {
  const on = ref(Object.fromEntries(GIBS_IDS.map((id) => [id, false])) as Record<GibsId, boolean>)
  /** the day each layer is showing, once known */
  const shownDay = ref<Partial<Record<GibsId, string>>>({})
  const error = ref<Partial<Record<GibsId, string>>>({})
  const loading = ref<Partial<Record<GibsId, boolean>>>({})

  const layers = new Map<GibsId, { day: string; layer: ImageryLayer }>()
  const requests = new Map<GibsId, number>()
  let settleTimer: ReturnType<typeof setTimeout> | undefined

  function remove(id: GibsId) {
    const shown = layers.get(id)
    if (shown) viewer.value?.imageryLayers.remove(shown.layer, true)
    layers.delete(id)
    delete shownDay.value[id]
  }

  async function sync(id: GibsId) {
    const v = viewer.value
    const request = (requests.get(id) ?? 0) + 1
    requests.set(id, request)
    const current = () => requests.get(id) === request
    if (!v || !on.value[id]) {
      remove(id)
      delete error.value[id]
      return v?.scene.requestRender()
    }
    const info = GIBS[id]
    loading.value[id] = true
    delete error.value[id]
    try {
      const day =
        timeline.mode.value === 'live' ? await latestDay(info) : await dayOnOrBefore(info, timeline.day.value)
      if (!current() || !on.value[id]) return
      if (!day) {
        remove(id)
        error.value[id] = 'NASA has no map for this day or the two before it.'
        return
      }
      if (layers.get(id)?.day === day) return
      remove(id)
      const layer = new ImageryLayer(gibsProvider(info, day), { alpha: OPACITY })
      v.imageryLayers.add(layer, 1) // above the base map, under markers and the other overlays
      layers.set(id, { day, layer })
      shownDay.value[id] = day
      v.scene.requestRender()
    } catch (err) {
      if (current()) error.value[id] = (err as Error).message
    } finally {
      if (current()) loading.value[id] = false
    }
  }

  const syncAll = () => GIBS_IDS.forEach((id) => void sync(id))

  // One sea overlay at a time: they cover the same water
  watch(
    () => GIBS_IDS.filter((id) => GIBS[id].sea && on.value[id]),
    (seaOn, before) => {
      const turnedOn = seaOn.filter((id) => !before?.includes(id))
      if (turnedOn.length) for (const id of seaOn) if (id !== turnedOn[0]) on.value[id] = false
    },
  )
  watch(on, syncAll, { deep: true })
  watch(viewer, syncAll)
  watch(timeline.mode, syncAll)
  watch(timeline.day, () => {
    clearTimeout(settleTimer)
    settleTimer = setTimeout(syncAll, SETTLE_MS)
  })

  onBeforeUnmount(() => {
    clearTimeout(settleTimer)
    for (const id of GIBS_IDS) remove(id)
  })

  return { on, shownDay, error, loading }
}
