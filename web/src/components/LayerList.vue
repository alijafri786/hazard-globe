<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { LAYER_GROUPS, type LayerRegistry } from '../layers/registry'

const props = defineProps<{ layers: LayerRegistry }>()
const emit = defineEmits<{ close: [] }>()
const { entries, live, reset } = props.layers

const grouped = computed(() =>
  LAYER_GROUPS.map((group) => ({ group, items: entries.filter((e) => e.group === group) })).filter((g) => g.items.length),
)

const root = ref<HTMLElement | null>(null)
const onKey = (e: KeyboardEvent) => e.key === 'Escape' && emit('close')
const onPointer = (e: PointerEvent) => {
  const target = e.target as Node
  // the button that opened it toggles it itself
  if (root.value && !root.value.contains(target) && !(target as Element).closest?.('.layers-button')) emit('close')
}
onMounted(() => {
  document.addEventListener('keydown', onKey)
  document.addEventListener('pointerdown', onPointer)
  root.value?.querySelector<HTMLInputElement>('input')?.focus()
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  document.removeEventListener('pointerdown', onPointer)
})
</script>

<template>
  <div ref="root" class="layer-list" role="dialog" aria-label="Layers">
    <div class="head">
      <strong>Layers</strong>
      <button type="button" class="link" @click="reset()">Events only</button>
    </div>
    <p v-if="!live" class="note">Looking back: layers marked “live” are hidden until you return to live.</p>
    <section v-for="g in grouped" :key="g.group">
      <h3>{{ g.group }}</h3>
      <label v-for="e in g.items" :key="e.id" class="row">
        <input v-model="e.on.value" type="checkbox" />
        <span :class="{ dim: e.liveOnly && !live }">{{ e.label }}</span>
        <small v-if="e.liveOnly">live</small>
      </label>
    </section>
    <p class="note">Each tab has more settings for its layers.</p>
  </div>
</template>

<style scoped>
.layer-list {
  position: absolute;
  top: 52px;
  right: 12px;
  z-index: 3;
  width: 260px;
  max-height: min(70vh, 560px);
  overflow-y: auto;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #111a2e;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

h3 {
  margin: 10px 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
  font-size: 14px;
  cursor: pointer;
}

.row small {
  margin-left: auto;
  font-size: 11px;
  color: var(--muted);
}

.dim {
  opacity: 0.55;
}

.note {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--muted);
}

.link {
  border: none;
  background: none;
  padding: 0;
  font-size: 12px;
  color: var(--accent);
  text-decoration: underline;
}

@media (max-width: 640px) {
  .layer-list {
    top: 48px;
    right: 8px;
    left: 8px;
    width: auto;
    /* inside the bottom sheet, which is at most 60% of the screen */
    max-height: calc(60vh - 64px);
  }
}
</style>
