import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// Own ports and a fresh store each run, so tests never touch a running dev server or real subscriptions.
// Set once in the environment: workers re-read this file, and must agree with the server on where mail goes.
const API_PORT = 8788
const WEB_PORT = 5174
const dataFile = (process.env.E2E_DATA_FILE ??= join(tmpdir(), `hazard-globe-e2e-${Date.now()}.json`))

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  // One at a time: tests share one server and its rate limits, and several software-rendered globes at once
  // slow each other past their timeouts
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    // Headless Chromium has no GPU: let Cesium's WebGL fall back to software rendering
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: [
    {
      command: 'npx tsx src/index.ts',
      cwd: '../server',
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      env: { E2E: '1', PORT: String(API_PORT), DATA_FILE: dataFile, PUBLIC_URL: `http://localhost:${WEB_PORT}` },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      // An empty token keeps tests on the bundled imagery instead of Cesium ion
      env: { API_PROXY_TARGET: `http://localhost:${API_PORT}`, VITE_CESIUM_ION_TOKEN: '' },
    },
  ],
})
