import {
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  HeadingPitchRange,
  Math as CesiumMath,
  Matrix4,
  SceneMode,
  Transforms,
  type Camera,
  type Viewer,
} from 'cesium'
import { onBeforeUnmount, onMounted, ref, watch, type ShallowRef } from 'vue'

export type CameraAction =
  | 'zoomIn'
  | 'zoomOut'
  | 'panUp'
  | 'panDown'
  | 'panLeft'
  | 'panRight'
  | 'rotateLeft'
  | 'rotateRight'
  | 'tiltUp'
  | 'tiltDown'

export const CAMERA_KEYS: Record<string, CameraAction> = {
  arrowup: 'panUp',
  arrowdown: 'panDown',
  arrowleft: 'panLeft',
  arrowright: 'panRight',
  '+': 'zoomIn',
  '=': 'zoomIn',
  '-': 'zoomOut',
  _: 'zoomOut',
  q: 'rotateLeft',
  e: 'rotateRight',
  w: 'tiltUp',
  s: 'tiltDown',
}

const EARTH_RADIUS_M = 6_371_000
const MIN_HEIGHT_M = 200
const MAX_HEIGHT_M = 40_000_000
// Rates per second while a control is held. Zoom and pan scale with altitude, so they feel the same
// from orbit and from street level.
const ZOOM_RATE = 1.2
const PAN_RATE = 0.8
const MAX_PAN_RADIANS = 0.6
const ROTATE_RATE = CesiumMath.toRadians(60)
const TILT_RATE = CesiumMath.toRadians(40)
// stop just short of straight down (where heading becomes undefined) and of the horizon
const MIN_PITCH = CesiumMath.toRadians(-89.5)
const MAX_PITCH = CesiumMath.toRadians(-5)
// a quick tap still moves a noticeable step
const MIN_HOLD_MS = 250

/** On-screen and keyboard camera controls, on top of Cesium's built-in mouse and touch gestures. */
export function useCameraControls(viewer: ShallowRef<Viewer | null>) {
  /** degrees clockwise from north, for the compass */
  const heading = ref(0)
  /** rotate and tilt orbit a point on the globe, which only makes sense in the 3D globe view */
  const is3D = ref(true)

  const holds = new Map<CameraAction, { released: boolean; minUntil: number }>()
  let frame = 0
  let last = 0

  /** the globe point at the centre of the screen, or under the camera when looking at the sky */
  function centreTarget(v: Viewer): Cartesian3 {
    const canvas = v.scene.canvas
    const centre = new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2)
    const hit = v.camera.pickEllipsoid(centre, v.scene.globe.ellipsoid)
    if (hit) return hit
    const below = v.camera.positionCartographic.clone()
    below.height = 0
    return v.scene.globe.ellipsoid.cartographicToCartesian(below)
  }

  /** altitude in 3D; the visible half-width in 2D, where the camera has no meaningful height */
  function viewScale(camera: Camera, mode: SceneMode): number {
    const f = camera.frustum as { left?: number; right?: number }
    return mode === SceneMode.SCENE2D && f.left !== undefined && f.right !== undefined
      ? (f.right - f.left) / 2
      : camera.positionCartographic.height
  }

  /** Rotates the camera about an axis through the globe point at the screen centre. */
  function orbitCentre(v: Viewer, rotate: (camera: Camera) => void) {
    const camera = v.camera
    camera.lookAtTransform(Transforms.eastNorthUpToFixedFrame(centreTarget(v)))
    rotate(camera)
    camera.lookAtTransform(Matrix4.IDENTITY)
  }

  function apply(v: Viewer, action: CameraAction, dt: number) {
    const camera = v.camera
    const mode = v.scene.mode
    const scale = viewScale(camera, mode)

    switch (action) {
      case 'zoomIn':
        if (scale > MIN_HEIGHT_M) camera.zoomIn(scale * ZOOM_RATE * dt)
        return
      case 'zoomOut':
        if (scale < MAX_HEIGHT_M) camera.zoomOut(scale * ZOOM_RATE * dt)
        return
    }

    if (mode !== SceneMode.SCENE3D) {
      // flat map views: slide the camera, and leave rotation to Cesium's own gestures
      const step = scale * PAN_RATE * dt
      if (action === 'panUp') camera.moveUp(step)
      else if (action === 'panDown') camera.moveDown(step)
      else if (action === 'panLeft') camera.moveLeft(step)
      else if (action === 'panRight') camera.moveRight(step)
      return
    }

    switch (action) {
      case 'panUp':
      case 'panDown':
      case 'panLeft':
      case 'panRight': {
        // Swing the camera around the Earth's centre along the screen's up/right directions, so
        // "up" means up on screen whatever the heading, not north. camera.rotateUp() etc. follow
        // north/east instead because of the default constrainedAxis.
        const angle = Math.min(scale / EARTH_RADIUS_M, MAX_PAN_RADIANS) * PAN_RATE * dt
        const outward = Cartesian3.normalize(camera.positionWC, new Cartesian3())
        const screenUp = Cartesian3.normalize(Cartesian3.cross(outward, camera.rightWC, new Cartesian3()), new Cartesian3())
        if (action === 'panUp') camera.rotate(camera.rightWC, angle)
        else if (action === 'panDown') camera.rotate(camera.rightWC, -angle)
        else if (action === 'panLeft') camera.rotate(screenUp, angle)
        else camera.rotate(screenUp, -angle)
        return
      }
      case 'rotateLeft':
      case 'rotateRight': {
        const angle = ROTATE_RATE * dt * (action === 'rotateLeft' ? -1 : 1)
        orbitCentre(v, (c) => c.rotate(Cartesian3.UNIT_Z, angle))
        return
      }
      case 'tiltUp':
      case 'tiltDown': {
        // Orbiting by an angle changes the pitch by about the same angle, so cap each step at the
        // limit. Going past straight down would flip the view round to face the other way.
        const room = action === 'tiltUp' ? MAX_PITCH - camera.pitch : camera.pitch - MIN_PITCH
        const angle = Math.min(TILT_RATE * dt, room)
        if (angle <= 0) return
        orbitCentre(v, (c) => c.rotate(c.right, action === 'tiltUp' ? -angle : angle))
        return
      }
    }
  }

  function step(now: number) {
    const v = viewer.value
    const dt = Math.min((now - last) / 1000, 0.1) // don't jump after a dropped frame or a background tab
    last = now
    for (const [action, hold] of holds) {
      if (v) apply(v, action, dt)
      if (hold.released && now >= hold.minUntil) holds.delete(action)
    }
    v?.scene.requestRender()
    frame = holds.size ? requestAnimationFrame(step) : 0
  }

  /** Starts moving the camera until stop() is called (at least MIN_HOLD_MS, so a tap is a step). */
  function start(action: CameraAction) {
    holds.set(action, { released: false, minUntil: performance.now() + MIN_HOLD_MS })
    if (!frame) {
      last = performance.now()
      frame = requestAnimationFrame(step)
    }
  }

  function stop(action: CameraAction) {
    const hold = holds.get(action)
    if (hold) hold.released = true
  }

  function tap(action: CameraAction) {
    start(action)
    stop(action)
  }

  function stopAll() {
    for (const action of holds.keys()) stop(action)
  }

  /** Turns to face north, keeping the same target, tilt and distance. */
  function resetNorth() {
    const v = viewer.value
    if (!v) return
    const camera = v.camera
    if (v.scene.mode !== SceneMode.SCENE3D) {
      camera.setView({ orientation: { heading: 0, pitch: camera.pitch, roll: 0 } })
      return
    }
    const target = centreTarget(v)
    const range = Cartesian3.distance(camera.positionWC, target)
    camera.flyToBoundingSphere(new BoundingSphere(target, 0), {
      offset: new HeadingPitchRange(0, camera.pitch, range),
      duration: 0.8,
    })
  }

  function isTyping(target: EventTarget | null) {
    const el = target as HTMLElement | null
    return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return
    const action = CAMERA_KEYS[e.key.toLowerCase()]
    if (!action) return
    e.preventDefault()
    if (!e.repeat) start(action)
  }

  function onKeyUp(e: KeyboardEvent) {
    const action = CAMERA_KEYS[e.key.toLowerCase()]
    if (action) stop(action)
  }

  watch(
    viewer,
    (v) => {
      if (!v) return
      v.scene.postRender.addEventListener(() => {
        const h = CesiumMath.toDegrees(v.camera.heading)
        if (Math.abs(h - heading.value) > 0.5) heading.value = h
      })
      v.scene.morphComplete.addEventListener(() => {
        is3D.value = v.scene.mode === SceneMode.SCENE3D
      })
    },
    { immediate: true },
  )

  onMounted(() => {
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', stopAll) // a key released in another window never sends keyup here
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', stopAll)
    cancelAnimationFrame(frame)
  })

  return { heading, is3D, start, stop, tap, resetNorth }
}
