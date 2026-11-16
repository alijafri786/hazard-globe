<script setup lang="ts">
import { computed } from 'vue'
import { FIRMS_URL, FRP_BANDS, type useFirmsLayer } from '../composables/useFirmsLayer'
import type { useTimeline } from '../composables/useTimeline'
import { SEQUENTIAL } from '../services/ramps'

const props = defineProps<{ firms: ReturnType<typeof useFirmsLayer>; timeline: ReturnType<typeof useTimeline> }>()
const { enabled, available, count, fetchedAt, scaleMax, close, loading, error } = props.firms
const { mode } = props.timeline

const gradient = `linear-gradient(to right, ${SEQUENTIAL.join(', ')})`
const updated = computed(() =>
  fetchedAt.value ? new Date(fetchedAt.value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null,
)
</script>

<template>
  <fieldset class="firms">
    <legend>Fires, live (NASA FIRMS)</legend>
    <label class="toggle">
      <input v-model="enabled" type="checkbox" />
      Every fire seen in the last day
    </label>

    <template v-if="enabled">
      <p v-if="mode === 'history'" class="meta">Live only: hidden while looking back.</p>
      <p v-else-if="available === false" class="meta">
        This server has no NASA FIRMS key, so it can't show single fires or alert about them. NASA's daily fire map,
        above, works without one.
      </p>
      <template v-else>
        <p v-if="error" class="error">Couldn't load fires: {{ error }}</p>
        <div v-if="!close && scaleMax" class="scale" aria-label="Fires per cell colours">
          <i :style="{ background: gradient }" />
          <div class="ends">
            <span>1</span>
            <span>{{ scaleMax }}+ fires in a 25 km cell</span>
          </div>
        </div>
        <ul v-if="close" class="bands" aria-label="Fire power colours">
          <li v-for="b in FRP_BANDS" :key="b.label"><i :style="{ background: b.colour }" />{{ b.label }}</li>
        </ul>
        <p class="meta" role="status">
          <span v-if="loading && count === null">Loading fires…</span>
          <span v-else-if="count !== null">
            {{ count.toLocaleString('en-GB') }} fires in the last day · {{ updated }}.
            {{ close ? 'Click one for when and how strong.' : 'Zoom in for single fires.' }}
          </span>
        </p>
      </template>
      <p class="credit">
        From <a :href="FIRMS_URL" target="_blank" rel="noopener">NASA FIRMS</a>: the VIIRS instruments on NOAA-20 and
        NOAA-21, within about 3 hours of each pass.
      </p>
    </template>
  </fieldset>
</template>

<style scoped>
.firms {
  margin: 0 0 12px;
  padding: 10px 0 0;
  border: none;
  border-top: 1px solid var(--line);
}

legend {
  padding: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
}

.toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 14px;
  cursor: pointer;
}

.scale i {
  display: block;
  height: 8px;
  border-radius: 4px;
}

.ends {
  display: flex;
  justify-content: space-between;
  margin-top: 2px;
  font-size: 11px;
  color: var(--muted);
}

.bands {
  display: flex;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 12px;
  color: var(--muted);
}

.bands i {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 4px;
  border-radius: 50%;
}

.meta,
.credit,
.error {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
}

.error {
  color: var(--red);
}

.credit a {
  color: var(--text);
}
</style>
