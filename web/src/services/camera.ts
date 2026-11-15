import { Math as CesiumMath, SceneMode, type Viewer } from 'cesium'

/** The scene modes a view can be in, as a link spells them; 3D is the default and isn't spelled */
export type ViewMode = '3d' | '2d' | 'cv'

export interface CameraView {
  mode: ViewMode
  lon: number
  lat: number
  /** metres above the ellipsoid; in 2D, Cesium's width of the view, which setView reads back the same way */
  height: number
  /** degrees */
  heading: number
  /** degrees */
  pitch: number
}

/**
 * Where the camera is, or undefined while the scene morphs between 3D, 2D and Columbus view. Mid-morph
 * Cesium's camera has no heading or pitch (asking for them in degrees throws), and its position is a
 * blend of two projections that names no real place. Every reader of the camera that may run during a
 * morph goes through this.
 */
export function cameraView(v: Viewer): CameraView | undefined {
  const mode = v.scene.mode
  if (mode === SceneMode.MORPHING) return undefined
  const heading = v.camera.heading as number | undefined
  const pitch = v.camera.pitch as number | undefined
  if (heading === undefined || pitch === undefined) return undefined
  const c = v.camera.positionCartographic
  return {
    mode: mode === SceneMode.SCENE2D ? '2d' : mode === SceneMode.COLUMBUS_VIEW ? 'cv' : '3d',
    lon: CesiumMath.toDegrees(c.longitude),
    lat: CesiumMath.toDegrees(c.latitude),
    height: c.height,
    heading: CesiumMath.toDegrees(heading),
    pitch: CesiumMath.toDegrees(pitch),
  }
}
