import { Credit, ImageryLayer, SingleTileImageryProvider, type Viewer } from 'cesium'
import type { Rgba } from './ramps'

/**
 * A regular grid over the whole globe, row-major from the north-west: row 0 runs along 90°N, column 0
 * starts at 180°W. Cesium has no heatmap of its own; drawn into one image, a grid becomes a map overlay.
 */
export interface GlobalGrid {
  cols: number
  rows: number
  value: (i: number) => number
}

/** The grid as an image, one pixel per cell, transparent wherever `colour` gives null */
export function gridImage(grid: GlobalGrid, colour: (v: number) => Rgba | null): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = grid.cols
  canvas.height = grid.rows
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(grid.cols, grid.rows)
  for (let i = 0; i < grid.cols * grid.rows; i++) {
    const c = colour(grid.value(i))
    if (!c) continue
    image.data.set(c, i * 4)
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

/**
 * Puts an image covering the whole globe (as gridImage makes) on the map as one imagery layer, above the
 * base map. Cesium smooths it as it magnifies, so cells blend rather than show as blocks.
 */
export function addGridLayer(viewer: Viewer, image: HTMLCanvasElement, credit: Credit, alpha = 1): ImageryLayer {
  const layer = ImageryLayer.fromProviderAsync(SingleTileImageryProvider.fromUrl(image.toDataURL('image/png'), { credit }), {
    alpha,
  })
  // The globe redraws only when asked (requestRenderMode): without this, adding the layer leaves it blank,
  // its tiles waiting on an image that loads after the last frame was drawn
  const ready = layer.readyEvent.addEventListener(() => {
    ready()
    viewer.scene.requestRender()
  })
  viewer.imageryLayers.add(layer, 1) // straight above the base map, under markers and other overlays
  viewer.scene.requestRender()
  return layer
}
