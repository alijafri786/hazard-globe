import { ScreenSpaceEventType, type ScreenSpaceEventHandler, type Viewer } from 'cesium'
import { watch, type ShallowRef } from 'vue'

/** Whatever `scene.pick` found under a click, if anything. Return true to claim the click. */
export type PickHandler = (picked: { collection?: unknown; id?: unknown } | undefined) => boolean

/**
 * One click handler for layers drawn as primitives (planes, satellites), which Cesium's own click, selecting
 * an entity, doesn't know about. Each layer says whether a pick is its own; anything unclaimed goes on to
 * Cesium's default.
 */
export function useGlobeClicks(viewer: ShallowRef<Viewer | null>) {
  const handlers: PickHandler[] = []

  watch(
    viewer,
    (v) => {
      if (!v) return
      const handler = v.screenSpaceEventHandler
      const defaultClick = handler.getInputAction(ScreenSpaceEventType.LEFT_CLICK) as
        | ((click: ScreenSpaceEventHandler.PositionedEvent) => void)
        | undefined
      handler.setInputAction((click: ScreenSpaceEventHandler.PositionedEvent) => {
        const picked = v.scene.pick(click.position)
        if (!handlers.some((claim) => claim(picked))) defaultClick?.(click)
      }, ScreenSpaceEventType.LEFT_CLICK)
    },
    { immediate: true },
  )

  return {
    onPick(handler: PickHandler) {
      handlers.push(handler)
    },
  }
}
