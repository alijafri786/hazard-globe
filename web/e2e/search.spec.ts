import { expect, test, type Page } from '@playwright/test'
import { stubHazardData } from './stubs'

const paris = {
  lat: '48.8534951',
  lon: '2.3483915',
  display_name: 'Paris, Île-de-France, France métropolitaine, France',
  boundingbox: ['48.8155755', '48.9021560', '2.2241220', '2.4697602'],
}

async function stubNominatim(page: Page, { fail = false } = {}) {
  const searches: URLSearchParams[] = []
  await page.route('https://nominatim.openstreetmap.org/**', (route) => {
    const q = new URL(route.request().url()).searchParams
    searches.push(q)
    if (fail) return route.fulfill({ status: 503 })
    return route.fulfill({ json: q.get('q') === 'paris' ? [paris] : [] })
  })
  return searches
}

const searchBox = (page: Page) => page.locator('.cesium-geocoder-input')
const pinTitle = (page: Page) => page.locator('.cesium-infoBox-title')

/** Types as a person would, key by key, so anything that searches as you type would fire */
async function search(page: Page, text: string) {
  const box = searchBox(page)
  await box.focus()
  await box.fill('')
  await box.pressSequentially(text, { delay: 20 })
  await box.press('Enter')
}

test('place search: only on Enter, pinned with its name, credited, cached', async ({ page }) => {
  await stubHazardData(page)
  const searches = await stubNominatim(page)
  await page.goto('/')

  const box = searchBox(page)
  await box.focus()
  await box.pressSequentially('Paris', { delay: 50 })
  await page.waitForTimeout(500)
  expect(searches).toHaveLength(0) // Nominatim's policy: no searching as you type

  await box.press('Enter')
  await expect(pinTitle(page)).toHaveText(paris.display_name)
  await expect(box).toHaveValue(paris.display_name)
  expect(searches).toHaveLength(1)
  expect(searches[0].get('q')).toBe('paris')
  expect(searches[0].get('format')).toBe('jsonv2')
  await expect(page.locator('.cesium-widget-credits')).toContainText('OpenStreetMap contributors')

  // The same search again comes from the cache
  await search(page, ' PARIS ')
  await expect(box).toHaveValue(paris.display_name)
  expect(searches).toHaveLength(1)

  await search(page, 'Nowhere at all')
  await expect(box).toHaveValue('Nowhere at all (not found)')

  // Home clears the search, and the pin with it
  await page.locator('.cesium-home-button').click()
  await expect(box).toHaveValue('')
  await expect(pinTitle(page)).not.toBeVisible()
})

test('coordinates go straight to the spot, latitude first, without asking Nominatim', async ({ page }) => {
  await stubHazardData(page)
  const searches = await stubNominatim(page)
  await page.goto('/')

  const cases = [
    ['48.8566, 2.3522', '48.8566° N, 2.3522° E'],
    ['-33.8688 151.2093', '33.8688° S, 151.2093° E'],
    ['51.5N 0.12W', '51.5000° N, 0.1200° W'],
    ['122.42W 37.77N', '37.7700° N, 122.4200° W'],
    // Only makes sense as longitude, latitude
    ['-122.42, 37.77', '37.7700° N, 122.4200° W'],
  ]
  for (const [typed, shown] of cases) {
    await search(page, typed)
    await expect(pinTitle(page)).toHaveText(shown)
  }
  expect(searches.map((q) => q.get('q'))).toEqual([])
})

test('search says so when Nominatim is down', async ({ page }) => {
  await stubHazardData(page)
  await stubNominatim(page, { fail: true })
  await page.goto('/')
  await search(page, 'Paris')
  await expect(searchBox(page)).toHaveValue('Paris (not found)')
})
