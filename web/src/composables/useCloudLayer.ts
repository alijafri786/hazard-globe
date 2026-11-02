import { Credit, ImageryLayer, SingleTileImageryProvider, type Viewer } from 'cesium'
import { computed, onBeforeUnmount, ref, shallowRef, watch, type ShallowRef } from 'vue'
import type { useTimeline } from './useTimeline'

/**
 * A loop of the last few hours of the world's clouds, from NOAA/NESDIS's Global Mosaic of Geostationary Satellite
 * Imagery (GMGSI) on nowCOAST: GOES, Himawari and Meteosat stitched into one infrared image an hour. Public domain,
 * and the only free source covering every longitude in one consistent image (NASA GIBS has no Meteosat).
 *
 * Each frame is fetched once, as a single whole-world image, and recoloured here so warm ground and sea are
 * see-through and cold cloud is white. Every frame is its own imagery layer and playing just changes which one is
 * visible: Cesium keeps a layer at alpha 0 loaded but skips drawing it, so looping makes no requests and doesn't
 * flicker.
 */
const WMS = 'https://nowcoast.noaa.gov/geoserver/satellite/global_longwave_imagery_mosaic/ows'
const LAYER = 'global_longwave_imagery_mosaic'
export const GMGSI_URL = 'https://www.ospo.noaa.gov/products/imagery/gmgsi.html'

const FRAME_WIDTH = 2048 // ~20 km a pixel: plenty for the whole globe, and a frame is ~1 MB
const MAX_FRAMES = 7
const REFRESH_MS = 15 * 60_000 // new frames come hourly
const FRAME_MS = 700
const HOLD_LATEST_MS = 1_800
const OPACITY = 0.9

// The mosaic's brightness follows cloud-top temperature: dark is warm ground or sea, white is cold, high cloud
const CLEAR = 100 // this dark or darker: see-through
const CLOUD = 215 // this bright or brighter: solid white
// The mosaic stops at about 72.7° N and S, with a ragged edge: fade out before it
const FADE_FROM_LAT = 68
const FADE_TO_LAT = 72

async function availableTimes(): Promise<string[]> {
  const res = await fetch(`${WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities`)
  if (!res.ok) throw new Error(`nowCOAST answered ${res.status}`)
  const xml = new DOMParser().parseFromString(await res.text(), 'text/xml')
  for (const dim of xml.getElementsByTagNameNS('*', 'Dimension')) {
    if (dim.getAttribute('name') === 'time' && dim.textContent?.trim()) {
      return dim.textContent.split(',').map((t) => new Date(t.trim()).toISOString()).sort()
    }
  }
  throw new Error('nowCOAST did not say which images it has')
}

/** Clouds white, fading to see-through over clear ground and sea, and away near the mosaic's edges. */
function cloudsOnly(image: ImageData) {
  const { data, width, height } = image
  for (let y = 0; y < height; y++) {
    const lat = Math.abs(90 - ((y + 0.5) * 180) / height)
    const edge = Math.min(1, Math.max(0, (FADE_TO_LAT - lat) / (FADE_TO_LAT - FADE_FROM_LAT)))
    for (let i = y * width * 4, end = i + width * 4; i < end; i += 4) {
      const t = Math.min(1, Math.max(0, (data[i] - CLEAR) / (CLOUD - CLEAR)))
      data[i] = data[i + 1] = data[i + 2] = 255
      data[i + 3] *= edge * t * t * (3 - 2 * t) // smoothstep, so thin cloud fades in gently
    }
  }
}

/** One frame, recoloured, as an object URL the imagery provider can load. */
async function loadFrame(time: string): Promise<string> {
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetMap',
    LAYERS: LAYER,
    STYLES: '',
    CRS: 'CRS:84',
    BBOX: '-180,-90,180,90',
    WIDTH: String(FRAME_WIDTH),
    HEIGHT: String(FRAME_WIDTH / 2),
    FORMAT: 'image/png',
    TRANSPARENT: 'true',
    TIME: time,
  })
  const res = await fetch(`${WMS}?${params}`)
  if (!res.ok) throw new Error(`nowCOAST answered ${res.status}`)
  const bitmap = await createImageBitmap(await res.blob())
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  cloudsOnly(image)
  ctx.putImageData(image, 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not prepare the cloud image'))), 'image/png'),
  )
  return URL.createObjectURL(blob)
}

export function useCloudLayer(viewer: ShallowRef<Viewer | null>, timeline: ReturnType<typeof useTimeline>) {
  const enabled = ref(false)
  /** Times of the frames on the globe, oldest first */
  const frames = shallowRef<string[]>([])
  /** The frame showing */
  const current = ref<string | null>(null)
  const playing = ref(!matchMedia('(prefers-reduced-motion: reduce)').matches)
  const loading = ref(false)
  const error = ref<string | null>(null)

  /** Recoloured frames by time. Kept while the page is open, so switching off and on again fetches nothing. */
  const urls = new Map<string, string>()
  const layers = new Map<string, ImageryLayer>()
  const credit = new Credit(
    `Clouds: <a href="${GMGSI_URL}" target="_blank" rel="noopener">NOAA/NESDIS GMGSI</a> via nowCOAST`,
    true,
  )
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  let playTimer: ReturnType<typeof setTimeout> | undefined
  let syncing: Promise<void> | null = null

  /** Only the current frame is visible, and none of them in History mode: these are the last few hours. */
  function applyFrame() {
    const live = timeline.mode.value === 'live'
    for (const [time, layer] of layers) {
      layer.show = live
      layer.alpha = time === current.value ? OPACITY : 0
    }
    viewer.value?.scene.requestRender()
  }

  function addLayer(v: Viewer, time: string) {
    const layer = ImageryLayer.fromProviderAsync(SingleTileImageryProvider.fromUrl(urls.get(time)!, { credit }), {
      alpha: 0,
    })
    v.imageryLayers.add(layer, 1) // straight above the base map, under any other overlay
    layers.set(time, layer)
  }

  function removeLayers(v: Viewer | null) {
    for (const layer of layers.values()) v?.imageryLayers.remove(layer, true)
    layers.clear()
    frames.value = []
  }

  async function doSync() {
    const v = viewer.value
    if (!v) return
    loading.value = true
    error.value = null
    try {
      const times = (await availableTimes()).slice(-MAX_FRAMES)
      // Newest first, so there's something to see as soon as possible
      for (const time of [...times].reverse()) {
        if (!enabled.value) return
        if (!urls.has(time)) urls.set(time, await loadFrame(time))
        if (!enabled.value) return
        if (!layers.has(time)) addLayer(v, time)
        frames.value = times.filter((t) => layers.has(t))
        if (!current.value || !layers.has(current.value)) current.value = time
        applyFrame()
      }
      // Drop frames that have aged out
      for (const [time, url] of urls) {
        if (times.includes(time)) continue
        const layer = layers.get(time)
        if (layer) v.imageryLayers.remove(layer, true)
        layers.delete(time)
        URL.revokeObjectURL(url)
        urls.delete(time)
      }
      frames.value = times.filter((t) => layers.has(t))
      if (current.value && !layers.has(current.value)) current.value = frames.value.at(-1) ?? null
    } catch (err) {
      error.value = (err as Error).message
    } finally {
      loading.value = false
      clearTimeout(refreshTimer)
      if (enabled.value) refreshTimer = setTimeout(() => void sync(), REFRESH_MS)
    }
  }

  function sync() {
    syncing ??= doSync().finally(() => {
      syncing = null
    })
    return syncing
  }

  function step(by: number) {
    const list = frames.value
    if (!list.length) return
    const i = current.value ? list.indexOf(current.value) : -1
    current.value = list[(i + by + list.length) % list.length]
  }

  function schedulePlay() {
    clearTimeout(playTimer)
    if (!enabled.value || !playing.value) return
    const atLatest = current.value === frames.value.at(-1)
    playTimer = setTimeout(() => {
      if (frames.value.length > 1 && !document.hidden) step(1)
      schedulePlay()
    }, atLatest ? HOLD_LATEST_MS : FRAME_MS)
  }

  /** For the slider: picking a frame pauses the loop there */
  const index = computed({
    get: () => (current.value ? Math.max(0, frames.value.indexOf(current.value)) : 0),
    set: (i: number) => {
      playing.value = false
      current.value = frames.value[i] ?? current.value
    },
  })

  watch(enabled, (on) => {
    clearTimeout(refreshTimer)
    if (on) {
      void sync()
    } else {
      removeLayers(viewer.value)
      current.value = null
      viewer.value?.scene.requestRender()
    }
    schedulePlay()
  })

  watch(current, applyFrame)
  watch(playing, schedulePlay)
  watch(timeline.mode, applyFrame)

  onBeforeUnmount(() => {
    clearTimeout(refreshTimer)
    clearTimeout(playTimer)
    for (const url of urls.values()) URL.revokeObjectURL(url)
  })

  return { enabled, frames, current, index, playing, loading, error, step }
}
