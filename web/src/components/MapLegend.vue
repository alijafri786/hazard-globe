<script setup lang="ts">
import { ref } from 'vue'
import type { LayerRegistry } from '../layers/registry'

defineProps<{ layers: LayerRegistry; beside: boolean }>()

// Folded away on a phone by default, where it would cover much of the globe
const open = ref(!matchMedia('(max-width: 640px)').matches)
</script>

<template>
  <aside v-if="layers.legends.value.length" class="map-legend" :class="{ beside }" aria-label="Map key">
    <button type="button" class="fold" :aria-expanded="open" @click="open = !open">
      Key <span aria-hidden="true">{{ open ? '▾' : '▸' }}</span>
    </button>
    <template v-if="open">
      <section v-for="l in layers.legends.value" :key="l.title">
        <h3>{{ l.title }}</h3>
        <ul v-if="'swatches' in l">
          <li v-for="s in l.swatches" :key="s.label">
            <img v-if="s.image" :src="s.image" alt="" width="12" height="12" />
            <i v-else :style="{ background: s.colour }" />
            {{ s.label }}
          </li>
        </ul>
        <template v-else>
          <i class="gradient" :style="{ background: `linear-gradient(to right, ${l.gradient.join(', ')})` }" />
          <div class="ends">
            <span v-for="e in l.ends" :key="e">{{ e }}</span>
          </div>
        </template>
      </section>
    </template>
  </aside>
</template>

<style scoped>
.map-legend {
  position: fixed;
  left: 16px;
  bottom: 36px; /* clear of Cesium's credit line */
  z-index: 1;
  max-width: 300px;
  max-height: calc(100% - 120px);
  overflow-y: auto;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
  font-size: 12px;
}

/* to the right of the side panel while it's open */
.map-legend.beside {
  left: 412px;
}

.fold {
  border: none;
  background: none;
  padding: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}

h3 {
  margin: 8px 0 4px;
  font-size: 12px;
  font-weight: 600;
}

ul {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--muted);
}

li {
  display: flex;
  align-items: center;
  gap: 4px;
}

li i {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.gradient {
  display: block;
  width: 200px;
  height: 8px;
  border-radius: 4px;
}

.ends {
  display: flex;
  justify-content: space-between;
  width: 200px;
  color: var(--muted);
}

@media (max-width: 640px) {
  .map-legend,
  .map-legend.beside {
    top: 8px;
    bottom: auto;
    left: 8px;
    max-width: 60%;
    max-height: 40%;
  }
}
</style>
