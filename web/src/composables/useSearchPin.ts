import {
  Cartesian2,
  Cartesian3,
  Color,
  CustomDataSource,
  GeocoderViewModel,
  HeightReference,
  LabelStyle,
  VerticalOrigin,
  type Viewer,
} from 'cesium'
import { shallowRef, watch, type ShallowRef } from 'vue'
import { formatCoordinates, places, type Place } from '../services/geocoders'
import { escapeHtml } from '../services/html'

// Map pin, tip at the bottom centre
const PIN_ICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36"><path fill="#7c5cff" stroke="#fff" stroke-width="2" d="M14 35C14 35 2 21.5 2 13a12 12 0 0 1 24 0c0 8.5-12 22-12 22z"/><circle cx="14" cy="13" r="4.5" fill="#fff"/></svg>',
)}`

/** Marks the place found by the globe's search box, and selects it so its full name and coordinates show. */export function useSearchPin(viewer: ShallowRef<Viewer | null>) {
  const pins = new CustomDataSource('search')
  /** The place pinned, until it's cleared */
  const found = shallowRef<Place | null>(null)

  watch(
    viewer,
    (v) => {
      if (!v?.geocoder) return
      void v.dataSources.add(pins)
      const model = v.geocoder.viewModel
      model.destinationFound = (vm, destination) => {
        GeocoderViewModel.flyToDestination(vm, destination)
        pins.entities.removeAll()
        const place = places.get(destination)
        found.value = place ?? null
        if (!place) return
        const { name, label } = place
        v.selectedEntity = pins.entities.add({
          name,
          position: Cartesian3.fromDegrees(place.lon, place.lat),
          billboard: {
            image: PIN_ICON,
            verticalOrigin: VerticalOrigin.BOTTOM,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY, // never hidden behind terrain
          },
          label: {
            text: label,
            font: '13px system-ui, sans-serif',
            style: LabelStyle.FILL_AND_OUTLINE,
            outlineWidth: 3,
            outlineColor: Color.BLACK,
            verticalOrigin: VerticalOrigin.BOTTOM,
            pixelOffset: new Cartesian2(0, -40),
            heightReference: HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          description: `<p>${escapeHtml(formatCoordinates(place.lon, place.lat))}</p>${
            place.attribution ? `<p style="opacity:.7;font-size:12px">${place.attribution}</p>` : ''
          }`,
        })
      }
      // Home clears the search box, so it clears the pin too
      v.homeButton?.viewModel.command.afterExecute.addEventListener(() => {
        pins.entities.removeAll()
        found.value = null
        v.scene.requestRender()
      })
    },
    { immediate: true },
  )

  return { found }
}
