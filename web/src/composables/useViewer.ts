import {
  buildModuleUrl,
  ImageryLayer,
  Ion,
  IonImageryProvider,
  Terrain,
  TileMapServiceImageryProvider,
  Viewer,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { onBeforeUnmount, onMounted, shallowRef, type Ref } from 'vue'

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
      geocoder: false,
      timeline: false,
      animation: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      sceneModePicker: true,
      homeButton: true,
      infoBox: true,
      selectionIndicator: true,
    })

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
