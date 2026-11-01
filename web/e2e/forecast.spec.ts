import { expect, test, type Page } from '@playwright/test'
import { stubHazardData } from './stubs'

// A 1×1 transparent PNG: tests never load real GloFAS imagery
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

const capabilities = `<?xml version="1.0"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms"><Capability><Layer><Name>GLOFAS_WMS</Name>
  <Layer><Name>reportingPoints</Name><Title>Reporting Points</Title>
    <Dimension name="time" units="ISO8601" default="2026-10-31T00:00Z">2011-01-01T00:00Z/2026-10-31T00:00Z/PT24H</Dimension>
  </Layer></Layer></Capability></WMS_Capabilities>`

async function stubGlofas(page: Page, { failCapabilities = false } = {}) {
  const maps: URLSearchParams[] = []
  const other: string[] = []
  await page.route('https://ows.globalfloods.eu/**', (route) => {
    const q = new URL(route.request().url()).searchParams
    const request = (q.get('request') ?? q.get('REQUEST') ?? '').toLowerCase()
    if (request === 'getcapabilities') {
      return failCapabilities ? route.fulfill({ status: 503 }) : route.fulfill({ contentType: 'text/xml', body: capabilities })
    }
    if (request === 'getmap') {
      maps.push(q)
      return route.fulfill({ contentType: 'image/png', body: PNG })
    }
    other.push(request)
    return route.fulfill({ status: 404 })
  })
  return { maps, other }
}

const layersRequested = (maps: URLSearchParams[]) => new Set(maps.map((q) => q.get('layers')))

test('flood forecast overlay: latest run, light requests, credit, hidden in history', async ({ page }) => {
  await stubHazardData(page)
  const glofas = await stubGlofas(page)
  await page.goto('/')
  expect(glofas.maps).toHaveLength(0) // nothing is fetched until it's switched on

  await page.getByLabel('Flood summary, next 15 days').check()
  await expect(page.getByText('Forecast issued Sat 31 Oct')).toBeVisible()
  await expect(page.getByText('A forecast, not a flood warning')).toContainText(
    `generated using Copernicus Emergency Management Service information ${new Date().getUTCFullYear()}`,
  )
  await expect.poll(() => glofas.maps.length).toBeGreaterThan(0)

  const map = glofas.maps[0]
  expect(map.get('layers')).toBe('FloodSummary1_30')
  expect(map.get('version')).toBe('1.3.0')
  expect(map.get('crs')).toBe('EPSG:3857')
  expect(map.get('time')).toBe('2026-10-31T00:00Z')
  expect(map.get('width')).toBe('512')
  // Web Mercator metres, west, south, east, north, within the projection's bounds
  const [west, south, east, north] = map.get('bbox')!.split(',').map(Number)
  const edge = 20_037_508.35
  expect(Math.max(...[west, south, east, north].map(Math.abs))).toBeLessThanOrEqual(edge)
  expect(east).toBeGreaterThan(west)
  expect(north).toBeGreaterThan(south)

  await page.getByLabel('River reporting points').check()
  await expect.poll(() => layersRequested(glofas.maps)).toEqual(new Set(['FloodSummary1_30', 'reportingPoints']))

  // Clicking the globe must not send feature queries to GloFAS
  await page.locator('.globe canvas').click({ position: { x: 640, y: 400 } })
  expect(glofas.other).toEqual([])

  await page.getByRole('button', { name: 'History' }).click()
  await expect(page.getByText("This shows today's forecast, so it's hidden while you look at history.")).toBeVisible()
  await page.getByRole('button', { name: 'Back to live' }).click()
  await expect(page.getByText('Forecast issued Sat 31 Oct')).toBeVisible()
})

test('flood forecast overlay: says so when GloFAS cannot be reached', async ({ page }) => {
  await stubHazardData(page)
  const glofas = await stubGlofas(page, { failCapabilities: true })
  await page.goto('/')
  await page.getByLabel('Flood summary, next 15 days').check()
  await expect(page.getByText("Couldn't load the GloFAS forecast: GloFAS answered 503")).toBeVisible()
  expect(glofas.maps).toHaveLength(0)
})
