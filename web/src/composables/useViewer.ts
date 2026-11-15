import {
  buildModuleUrl,
  Cartesian3,
  type Camera,
  ImageryLayer,
  Ion,
  IonImageryProvider,
  Terrain,
  TileMapServiceImageryProvider,
  Viewer,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { onBeforeUnmount, onMounted, shallowRef, type Ref } from 'vue'
import { CoordinateGeocoderService, LazyIonGeocoderService, NominatimGeocoderService } from '../services/geocoders'

/**
 * Cesium's zoom-to-cursor turns the camera about the axis between the point under the cursor and the one
 * under the screen's centre. Looking straight down with the cursor on the centre pixel, those can be the
 * same point while rounding still lets the turn through with a zero axis, and Cesium stops rendering
 * ("normalized result is not a number"). Seen with world terrain on. A turn about no axis does nothing,
 * so it's skipped.
 */
function guardZeroAxisRotation(camera: Camera) {
  const rotate = camera.rotate.bind(camera)
  camera.rotate = (axis: Cartesian3, angle?: number) => {
    if (Cartesian3.magnitudeSquared(axis) > 0 && Number.isFinite(angle ?? 0)) rotate(axis, angle)
  }
}

/**
 * Creates a Cesium Viewer that works with NO Cesium ion token (bundled Natural Earth imagery),
 * and upgrades to ion imagery + world terrain when VITE_CESIUM_ION_TOKEN is set.
 * The viewer is kept in a shallowRef so Vue never makes Cesium objects reactive.
 */
export function useViewer(container: Ref<HTMLElement | null>) {
  const viewer = shallowRef<Viewer | null>(null)

  onMounted(() => {
    if (!container.value) return
    const token = import.meta.env.VITE_CESIUM_ION_TOKEN

    if (token) Ion.defaultAccessToken = token

    const baseLayer = token
      ? ImageryLayer.fromProviderAsync(IonImageryProvider.fromAssetId(2)) // Bing Maps Aerial via ion
      : ImageryLayer.fromProviderAsync(
          TileMapServiceImageryProvider.fromUrl(buildModuleUrl('Assets/Textures/NaturalEarthII')),
        )

    viewer.value = new Viewer(container.value, {
      baseLayer,
      terrain: token ? Terrain.fromWorldTerrain() : undefined,
      baseLayerPicker: false,
      // Coordinates first, so they're never sent off as a place name
      geocoder: [
        new CoordinateGeocoderService(),
        token ? new LazyIonGeocoderService(() => viewer.value?.scene) : new NominatimGeocoderService(),
      ],
      timeline: false,
      animation: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      sceneModePicker: true,
      homeButton: true,
      infoBox: true,
      selectionIndicator: true,
    })

    // Nominatim can't search as you type, and Cesium drops a search's credits whenever it tries to
    if (!token) viewer.value.geocoder.viewModel.autoComplete = false

    guardZeroAxisRotation(viewer.value.camera)

    const scene = viewer.value.scene
    scene.globe.enableLighting = false
    scene.requestRenderMode = true // only redraw when something changes: big battery win on mobile
    scene.maximumRenderTimeChange = Infinity
  })

  onBeforeUnmount(() => {
    viewer.value?.destroy()
    viewer.value = null
  })

  return viewer
}
