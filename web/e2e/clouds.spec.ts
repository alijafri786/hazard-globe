import { expect, test, type Page } from '@playwright/test'
import { stubHazardData, stubNominatim } from './stubs'

// A 1×1 transparent PNG: tests never load real satellite images
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

const HOUR = 3_600_000
const latest = Math.floor(Date.now() / HOUR) * HOUR - HOUR
const times = [3, 2, 1, 0].map((n) => new Date(latest - n * HOUR).toISOString())
const label = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })

const capabilities = `<?xml version="1.0"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms"><Capability><Layer>
  <Layer><Name>global_longwave_imagery_mosaic</Name>
    <Dimension name="time" default="${times.at(-1)}" units="ISO8601" nearestValue="1">${times.join(',')}</Dimension>
  </Layer></Layer></Capability></WMS_Capabilities>`

async function stubNowCoast(page: Page, { fail = false } = {}) {
  const maps: URLSearchParams[] = []
  let capabilityRequests = 0
  await page.route('https://nowcoast.noaa.gov/**', (route) => {
    const q = new URL(route.request().url()).searchParams
    const request = q.get('REQUEST')?.toLowerCase()
    if (request === 'getcapabilities') {
      capabilityRequests++
      return fail ? route.fulfill({ status: 503 }) : route.fulfill({ contentType: 'text/xml', body: capabilities })
    }
    if (request === 'getmap') {
      maps.push(q)
      return route.fulfill({ contentType: 'image/png', body: PNG })
    }
    return route.fulfill({ status: 404 })
  })
  return { maps, capabilities: () => capabilityRequests }
}

const shownTime = (page: Page) => page.locator('.clouds .time')
const credits = (page: Page) => page.locator('.cesium-widget-credits')

test.use({ timezoneId: 'UTC' })

test('clouds: fetched once as whole-world frames, played, scrubbed, credited, hidden in history', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }) // starts paused, so what shows is predictable
  await stubHazardData(page)
  await stubNominatim(page)
  await page.route(/\/api\/events\/history/, (r) =>
    r.fulfill({ json: { fetchedAt: new Date().toISOString(), days: 30, type: 'FeatureCollection', features: [] } }),
  )
  const nowCoast = await stubNowCoast(page)
  await page.goto('/')
  await page.getByRole('tab', { name: 'Weather' }).click()
  expect(nowCoast.capabilities()).toBe(0) // nothing until it's switched on

  await page.getByLabel('Show clouds, last few hours').check()
  await expect(shownTime(page)).toContainText(label(times[3]))
  await expect(page.getByText('Loading cloud images')).toBeHidden()
  await expect(credits(page)).toContainText('NOAA/NESDIS GMGSI')

  // One whole-world image per hour, newest first
  expect(nowCoast.maps.map((q) => q.get('TIME'))).toEqual([...times].reverse())
  const map = nowCoast.maps[0]
  expect(map.get('LAYERS')).toBe('global_longwave_imagery_mosaic')
  expect(map.get('CRS')).toBe('CRS:84')
  expect(map.get('BBOX')).toBe('-180,-90,180,90')
  expect([map.get('WIDTH'), map.get('HEIGHT')]).toEqual(['2048', '1024'])

  const slider = page.getByRole('slider', { name: 'Cloud image time' })
  await slider.fill('0')
  await expect(shownTime(page)).toContainText(label(times[0]))
  await expect(shownTime(page)).toContainText('h ago')

  // Playing loops through the frames without asking for any again
  await page.getByRole('button', { name: 'Play clouds' }).click()
  await expect(shownTime(page)).toContainText(label(times[2]))
  await expect(shownTime(page)).toContainText(label(times[0]), { timeout: 10_000 }) // round again
  await page.getByRole('button', { name: 'Pause clouds' }).click()
  expect(nowCoast.maps).toHaveLength(4)

  // The last few hours, so not shown against a past day
  await page.getByRole('tab', { name: 'Events' }).click()
  await page.getByRole('button', { name: 'History' }).click()
  await expect(credits(page)).not.toContainText('NOAA/NESDIS GMGSI')
  await page.getByRole('tab', { name: 'Weather' }).click()
  await expect(page.getByText("Weather shows the last few hours, so it's hidden while you look at history.")).toBeVisible()
  await page.getByRole('button', { name: 'Back to live' }).click()
  await expect(credits(page)).toContainText('NOAA/NESDIS GMGSI')

  // Off and on again: the frames are kept, only the list of times is checked
  await page.getByLabel('Show clouds, last few hours').uncheck()
  await expect(credits(page)).not.toContainText('NOAA/NESDIS GMGSI')
  await page.getByLabel('Show clouds, last few hours').check()
  await expect(shownTime(page)).toBeVisible()
  await expect(credits(page)).toContainText('NOAA/NESDIS GMGSI')
  expect(nowCoast.capabilities()).toBe(2)
  expect(nowCoast.maps).toHaveLength(4)
})

test('clouds: says so when nowCOAST cannot be reached', async ({ page }) => {
  await stubHazardData(page)
  await stubNominatim(page)
  await stubNowCoast(page, { fail: true })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Weather' }).click()
  await page.getByLabel('Show clouds, last few hours').check()
  await expect(page.getByText("Couldn't load cloud images: nowCOAST answered 503")).toBeVisible()
})
