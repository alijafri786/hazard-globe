import { expect, test, type Page } from '@playwright/test'
import { searchGlobe as search, stubHazardData, stubNominatim } from './stubs'

const paris = {
  latitude: 48.86,
  longitude: 2.36,
  elevation: 43,
  utc_offset_seconds: 3600,
  timezone_abbreviation: 'GMT+1',
  current: {
    time: '2026-11-01T23:45',
    interval: 900,
    temperature_2m: 12.3,
    apparent_temperature: 9.2,
    relative_humidity_2m: 81,
    wind_speed_10m: 19.4,
    wind_direction_10m: 225,
    weather_code: 61,
    is_day: 0,
  },
}

async function stubOpenMeteo(page: Page, { fail = false } = {}) {
  const asked: URLSearchParams[] = []
  await page.route('https://api.open-meteo.com/**', (route) => {
    asked.push(new URL(route.request().url()).searchParams)
    if (fail) return route.fulfill({ status: 429, json: { error: true, reason: 'Daily API request limit exceeded' } })
    return route.fulfill({ json: paris })
  })
  return asked
}

async function openWeather(page: Page) {
  await stubNominatim(page) // coordinates never reach it, but a mistyped search mustn't go out to it either
  await page.goto('/')
  await page.getByRole('tab', { name: 'Weather' }).click()
}

const card = (page: Page) => page.locator('.card')
const details = (page: Page) => card(page).locator('dd')
const credits = (page: Page) => page.locator('.cesium-widget-credits')

test('temperature anywhere: pick a spot, switch units, clear, hidden in history', async ({ page }) => {
  await stubHazardData(page)
  await page.route(/\/api\/events\/history/, (r) =>
    r.fulfill({ json: { fetchedAt: new Date().toISOString(), days: 30, type: 'FeatureCollection', features: [] } }),
  )
  const asked = await stubOpenMeteo(page)
  await openWeather(page)
  expect(asked).toHaveLength(0) // nothing is fetched until someone asks

  await page.getByRole('button', { name: 'Pick on globe' }).click()
  await expect(page.getByText('Tap the globe to check the temperature')).toBeVisible()
  const box = (await page.locator('.globe canvas').boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2) // the globe is centred at the start
  await expect(page.getByText('Tap the globe to check the temperature')).toBeHidden()

  await expect(card(page).locator('.temperature')).toHaveText('12 °C')
  await expect(card(page)).toContainText('Light rain')
  await expect(details(page)).toHaveText(['9 °C', '81%', '19 km/h from the SW', /^\d\d:\d\d GMT\+1$/])
  await expect(credits(page)).toContainText('Open-Meteo.com')

  expect(asked).toHaveLength(1)
  const q = asked[0]
  expect(q.get('timezone')).toBe('auto')
  expect(q.get('current')).toContain('temperature_2m')
  // Rounded to ~1 km, which is all the model grid resolves
  expect(q.get('latitude')).toMatch(/^-?\d+\.\d\d$/)
  expect(q.get('longitude')).toMatch(/^-?\d+\.\d\d$/)

  await page.getByRole('button', { name: '°F, mph' }).click()
  await expect(card(page).locator('.temperature')).toHaveText('54 °F')
  await expect(details(page)).toHaveText(['49 °F', '81%', '12 mph from the SW', /GMT\+1$/])
  expect(asked).toHaveLength(1) // converted here, not asked for again
  expect(await page.evaluate(() => localStorage.getItem('hazard-globe:temperature-unit'))).toBe('F')

  // History shows past days, and this is the weather now
  await page.getByRole('tab', { name: 'Events' }).click()
  await page.getByRole('button', { name: 'History' }).click()
  await page.getByRole('tab', { name: 'Weather' }).click()
  await expect(page.getByText("Weather shows the last few hours, so it's hidden while you look at history.")).toBeVisible()
  await expect(credits(page)).not.toContainText('Open-Meteo.com')
  await page.getByRole('button', { name: 'Back to live' }).click()
  await expect(card(page).locator('.temperature')).toHaveText('54 °F')
  await expect(credits(page)).toContainText('Open-Meteo.com')

  await page.getByRole('button', { name: 'Clear' }).click()
  await expect(card(page)).toBeHidden()
  await expect(credits(page)).not.toContainText('Open-Meteo.com')
})

test('a search from the Weather tab shows the weather there; from elsewhere, it is offered', async ({ page }) => {
  await stubHazardData(page)
  const asked = await stubOpenMeteo(page)
  await openWeather(page)

  await search(page, '48.8566, 2.3522')
  await expect(card(page).locator('strong')).toHaveText('48.8566° N, 2.3522° E')
  await expect(card(page).locator('.temperature')).toHaveText('12 °C')
  expect(asked.map((q) => [q.get('latitude'), q.get('longitude')])).toEqual([['48.86', '2.35']])

  await page.getByRole('tab', { name: 'Events' }).click()
  await search(page, '-33.8688 151.2093')
  await expect(page.locator('.cesium-infoBox-title')).toHaveText('33.8688° S, 151.2093° E')
  expect(asked).toHaveLength(1)

  await page.getByRole('tab', { name: 'Weather' }).click()
  await page.getByRole('button', { name: 'Check 33.8688° S, 151.2093° E' }).click()
  await expect(card(page).locator('strong')).toHaveText('33.8688° S, 151.2093° E')
  expect(asked.map((q) => q.get('latitude'))).toEqual(['48.86', '-33.87'])
  await expect(page.getByRole('button', { name: /^Check / })).toBeHidden()
})

test.describe('with location allowed', () => {
  test.use({ geolocation: { latitude: 51.5072, longitude: -0.1276 }, permissions: ['geolocation'] })

  test('use my location', async ({ page }) => {
    await stubHazardData(page)
    const asked = await stubOpenMeteo(page)
    await openWeather(page)
    await page.getByRole('button', { name: 'Use my location' }).click()
    await expect(card(page).locator('strong')).toHaveText('51.5072° N, 0.1276° W')
    expect(asked.map((q) => [q.get('latitude'), q.get('longitude')])).toEqual([['51.51', '-0.13']])
  })
})

test('says why when Open-Meteo refuses', async ({ page }) => {
  await stubHazardData(page)
  await stubOpenMeteo(page, { fail: true })
  await openWeather(page)
  await search(page, '48.8566, 2.3522')
  await expect(card(page)).toContainText("Couldn't get the weather: Daily API request limit exceeded")
})
