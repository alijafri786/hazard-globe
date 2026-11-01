<script setup lang="ts">
import type { CameraAction, useCameraControls } from '../composables/useCameraControls'

const props = defineProps<{ controls: ReturnType<typeof useCameraControls> }>()
const { heading, is3D, start, stop, tap, resetNorth } = props.controls

// Pointer down/up gives press-and-hold; a click with detail 0 is Enter/Space on a focused button.
function bind(action: CameraAction) {
  return {
    onPointerdown: (e: PointerEvent) => e.button === 0 && start(action),
    onPointerup: () => stop(action),
    onPointerleave: () => stop(action),
    onPointercancel: () => stop(action),
    onClick: (e: MouseEvent) => e.detail === 0 && tap(action),
  }
}
</script>

<template>
  <div class="camera" role="group" aria-label="Camera controls" @contextmenu.prevent>
    <button
      class="compass"
      title="Face north"
      aria-label="Face north"
      :disabled="!is3D"
      @click="resetNorth()"
    >
      <svg viewBox="0 0 24 24" :style="{ transform: `rotate(${-heading}deg)` }" aria-hidden="true">
        <path d="M12 2.5l3.2 9.5H8.8z" class="north" />
        <path d="M12 21.5l-3.2-9.5h6.4z" class="south" />
      </svg>
    </button>

    <div class="pad">
      <button class="up" title="Pan up (↑)" aria-label="Pan up" v-bind="bind('panUp')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
      </button>
      <button class="left" title="Pan left (←)" aria-label="Pan left" v-bind="bind('panLeft')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
      </button>
      <button class="right" title="Pan right (→)" aria-label="Pan right" v-bind="bind('panRight')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      </button>
      <button class="down" title="Pan down (↓)" aria-label="Pan down" v-bind="bind('panDown')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
    </div>

    <div class="pair">
      <button title="Rotate left (Q)" aria-label="Rotate left" :disabled="!is3D" v-bind="bind('rotateLeft')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4v6h6" /><path d="M5.2 15a8 8 0 1 0 1.9-8.3L3 10" /></svg>
      </button>
      <button title="Rotate right (E)" aria-label="Rotate right" :disabled="!is3D" v-bind="bind('rotateRight')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 4v6h-6" /><path d="M18.8 15a8 8 0 1 1-1.9-8.3L21 10" /></svg>
      </button>
    </div>

    <div class="pair">
      <button title="Tilt towards the horizon (W)" aria-label="Tilt towards the horizon" :disabled="!is3D" v-bind="bind('tiltUp')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 7h7L20 18H4z" /></svg>
      </button>
      <button title="Look straight down (S)" aria-label="Look straight down" :disabled="!is3D" v-bind="bind('tiltDown')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="1" /></svg>
      </button>
    </div>

    <div class="zoom">
      <button title="Zoom in (+)" aria-label="Zoom in" v-bind="bind('zoomIn')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      </button>
      <button title="Zoom out (−)" aria-label="Zoom out" v-bind="bind('zoomOut')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.camera {
  position: fixed;
  right: 16px;
  bottom: 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
}

button {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  background: var(--panel);
  backdrop-filter: blur(10px);
}

svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.compass {
  width: 44px;
  height: 44px;
  border-radius: 50%;
}

.compass svg {
  width: 28px;
  height: 28px;
  stroke: none;
  transition: transform 0.15s linear;
}

.compass .north {
  fill: var(--red);
}

.compass .south {
  fill: var(--muted);
}

.pad {
  display: grid;
  grid-template-columns: repeat(3, 36px);
  grid-template-rows: repeat(3, 36px);
  gap: 2px;
}

.pad .up {
  grid-area: 1 / 2;
}

.pad .left {
  grid-area: 2 / 1;
}

.pad .right {
  grid-area: 2 / 3;
}

.pad .down {
  grid-area: 3 / 2;
}

.pair {
  display: flex;
  gap: 2px;
}

.zoom {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* Mobile: the panel is a bottom sheet and pinch/drag gestures cover panning,
   so keep only the compass and zoom, tucked under Cesium's toolbar. */
@media (max-width: 640px) {
  .camera {
    top: 56px;
    bottom: auto;
    right: 8px;
  }

  .pad,
  .pair {
    display: none;
  }
}
</style>
