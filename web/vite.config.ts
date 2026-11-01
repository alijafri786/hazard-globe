import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig, normalizePath } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// Cesium ships workers, widgets and assets that must be served as static files.
// This is Cesium's own recommended Vite setup — no wrapper library needed.
// Resolve the package rather than assuming web/node_modules: npm workspaces hoist it to the repo root.
const cesiumDir = dirname(createRequire(import.meta.url).resolve('cesium/package.json'))
const cesiumSource = normalizePath(relative(process.cwd(), join(cesiumDir, 'Build/Cesium')))
const cesiumBaseUrl = 'cesium'

export default defineConfig({
  define: {
    CESIUM_BASE_URL: JSON.stringify(`/${cesiumBaseUrl}`),
  },
  plugins: [
    vue(),
    viteStaticCopy({
      targets: [
        { src: `${cesiumSource}/ThirdParty`, dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Workers`, dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Assets`, dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Widgets`, dest: cesiumBaseUrl },
      ],
    }),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
