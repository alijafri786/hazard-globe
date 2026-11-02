import { Cartesian3, Ellipsoid, EllipsoidalOccluder, Math as CesiumMath, Matrix4, SceneMode, type Viewer } from 'cesium'
import type { WindGrid } from '../types'

export interface WindParticleOptions {
  count: number
  /** Trail colours from calm to `maxSpeed` m/s and above */
  colours: string[]
  maxSpeed: number
}

interface Particle {
  lon: number
  lat: number
  age: number
  maxAge: number
  /** Where it was on screen last frame; NaN when it wasn't visible */
  x: number
  y: number
}

const FRAME_MS = 1000 / 30
/** Each frame, trails keep this much of what was drawn before */
const FADE = 0.95
/** Degrees moved per frame per m/s of wind, when the camera is 10,000 km up: scaled with height so that on
 * screen particles move at about the same speed however far in or out */
const DEGREES_PER_MS = 0.006
/** Slower than this, a particle would only draw a speckle */
const CALM_MS = 0.7
const MIN_AGE = 40
const MAX_AGE = 110

/**
 * Wind as moving particles on a transparent canvas over the globe, the way earth.nullschool.net draws it:
 * each frame every particle moves with the wind where it is, a short line is drawn from where it was, and
 * what was there before fades, which leaves trails. Positions go to the screen through Cesium's public
 * transforms, so this doesn't depend on Cesium's internals, and the globe itself needn't redraw for it.
 */
export class WindParticles {
  private readonly canvas = document.createElement('canvas')
  private readonly ctx: CanvasRenderingContext2D
  private readonly particles: Particle[] = []
  private readonly lastView = new Matrix4()
  private readonly scratch = new Cartesian3()
  private u = new Float32Array(0)
  private v = new Float32Array(0)
  private width = 0
  private height = 0
  private frame = 0
  private lastFrameAt = 0
  private running = false

  constructor(
    private readonly viewer: Viewer,
    grid: WindGrid,
    private readonly options: WindParticleOptions,
  ) {
    Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' })
    this.canvas.className = 'wind-particles'
    this.ctx = this.canvas.getContext('2d')!
    // Straight above the globe, below Cesium's own controls and info box
    viewer.scene.canvas.after(this.canvas)
    this.setGrid(grid)
    for (let i = 0; i < options.count; i++) this.particles.push(this.spawn({} as Particle, true))
  }

  setGrid(grid: WindGrid) {
    this.u = Float32Array.from(grid.u)
    this.v = Float32Array.from(grid.v)
    this.width = grid.width
    this.height = grid.height
  }

  start() {
    if (this.running) return
    this.running = true
    this.canvas.style.display = ''
    this.frame = requestAnimationFrame(this.step)
  }

  stop() {
    this.running = false
    cancelAnimationFrame(this.frame)
    this.canvas.style.display = 'none'
    this.clear()
  }

  destroy() {
    this.stop()
    this.canvas.remove()
  }

  /** Wind at a point, m/s, interpolated between the grid's points (rows north to south, from 180°W) */
  sample(lon: number, lat: number): [number, number] {
    const x = Math.min(this.width - 1.001, Math.max(0, ((((lon + 180) % 360) + 360) % 360)))
    const y = Math.min(this.height - 1.001, Math.max(0, 90 - lat))
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = x - x0
    const fy = y - y0
    const i = y0 * this.width + x0
    const j = i + this.width
    const mix = (a: Float32Array) =>
      (a[i] * (1 - fx) + a[i + 1] * fx) * (1 - fy) + (a[j] * (1 - fx) + a[j + 1] * fx) * fy
    return [mix(this.u), mix(this.v)]
  }

  private clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  private resize(): boolean {
    const source = this.viewer.scene.canvas
    if (this.canvas.width === source.width && this.canvas.height === source.height) return false
    this.canvas.width = source.width
    this.canvas.height = source.height
    return true
  }

  /** A new particle somewhere in view (or anywhere, when the whole globe is in view) */
  private spawn(p: Particle, initial = false): Particle {
    const view = this.viewer.camera.computeViewRectangle()
    const whole = !view || this.viewer.camera.positionCartographic.height > 8e6
    if (whole) {
      p.lon = Math.random() * 360 - 180
      p.lat = CesiumMath.toDegrees(Math.asin(Math.random() * 2 - 1)) // even over the sphere, not bunched at the poles
    } else {
      let span = view.east - view.west
      if (span < 0) span += CesiumMath.TWO_PI
      p.lon = CesiumMath.toDegrees(view.west + Math.random() * span)
      p.lat = CesiumMath.toDegrees(view.south + Math.random() * (view.north - view.south))
    }
    p.maxAge = MIN_AGE + Math.random() * (MAX_AGE - MIN_AGE)
    p.age = initial ? Math.random() * p.maxAge : 0
    p.x = Number.NaN
    p.y = Number.NaN
    return p
  }

  private readonly step = (now: number) => {
    if (!this.running) return
    this.frame = requestAnimationFrame(this.step)
    if (now - this.lastFrameAt < FRAME_MS) return
    this.lastFrameAt = now

    const { scene, camera } = this.viewer
    const resized = this.resize()
    const moved = !Matrix4.equalsEpsilon(camera.viewMatrix, this.lastView, 1e-9)
    Matrix4.clone(camera.viewMatrix, this.lastView)
    const ctx = this.ctx
    if (resized || moved) {
      // Old trails would be in the wrong place on screen
      this.clear()
      for (const p of this.particles) p.x = Number.NaN
    } else {
      ctx.globalCompositeOperation = 'destination-in'
      ctx.fillStyle = `rgba(0, 0, 0, ${FADE})`
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
      ctx.globalCompositeOperation = 'source-over'
    }

    const in3D = scene.mode === SceneMode.SCENE3D
    const occluder = in3D ? new EllipsoidalOccluder(Ellipsoid.WGS84, camera.positionWC) : null
    const step = DEGREES_PER_MS * Math.max(0.05, camera.positionCartographic.height / 1e7)
    // Cesium's canvas pixels per CSS pixel: not always the device pixel ratio
    const scale = scene.canvas.width / (scene.canvas.clientWidth || scene.canvas.width)
    const { colours, maxSpeed } = this.options
    const paths = colours.map(() => new Path2D())

    for (const p of this.particles) {
      if (++p.age > p.maxAge) {
        this.spawn(p)
        continue
      }
      const [u, v] = this.sample(p.lon, p.lat)
      const speed = Math.hypot(u, v)
      p.lat = Math.max(-89.9, Math.min(89.9, p.lat + v * step))
      p.lon += (u * step) / Math.max(0.05, Math.cos(CesiumMath.toRadians(p.lat)))
      if (p.lon > 180) p.lon -= 360
      else if (p.lon < -180) p.lon += 360

      const world = Cartesian3.fromDegrees(p.lon, p.lat, 0, undefined, this.scratch)
      const screen = occluder && !occluder.isPointVisible(world) ? undefined : scene.cartesianToCanvasCoordinates(world)
      if (!screen) {
        p.x = Number.NaN
        continue
      }
      const x = screen.x * scale
      const y = screen.y * scale
      if (!Number.isNaN(p.x) && speed >= CALM_MS) {
        const path = paths[Math.min(colours.length - 1, Math.floor((speed / maxSpeed) * colours.length))]
        path.moveTo(p.x, p.y)
        path.lineTo(x, y)
      }
      p.x = x
      p.y = y
    }

    ctx.lineWidth = 1.6 * scale
    ctx.lineCap = 'butt' // round caps leave a dot wherever a slow particle barely moves
    paths.forEach((path, i) => {
      ctx.strokeStyle = colours[i]
      ctx.stroke(path)
    })
  }
}
