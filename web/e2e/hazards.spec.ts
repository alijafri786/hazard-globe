import { expect, test, type Page } from '@playwright/test'

test.use({ geolocation: { latitude: 51.5, longitude: -0.12 }, permissions: ['geolocation'] })

const now = new Date().toISOString().slice(0, 19)

function event(eventtype: string, eventid: number, name: string, lon: number) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, 10] },
    properties: { eventtype, eventid, episodeid: 1, name, alertlevel: 'Orange', country: 'Atlantis', fromdate: now, todate: now },
  }
}

const events = [
  event('TC', 1, 'Storm Alpha', 10),
  event('FL', 2, 'Flood in Atlantis', 20),
  event('EQ', 3, 'Earthquake in Atlantis', 30),
  event('VO', 4, 'Eruption Mount Doom', 40),
  event('WF', 5, 'Forest fires in Atlantis', 50),
  event('DR', 6, 'Drought in Atlantis', 60),
]

const listed = (page: Page) => page.locator('.events strong')
const kinds = (page: Page) => page.locator('.events small')

test('every GDACS hazard type is listed, and each can be hidden', async ({ page }) => {
  await page.route('**/api/events', (r) =>
    r.fulfill({ json: { fetchedAt: new Date().toISOString(), days: 10, type: 'FeatureCollection', features: events } }),
  )
  await page.goto('/')

  await expect(listed(page)).toHaveCount(6)
  await expect(kinds(page)).toHaveText([
    'Cyclone · Atlantis',
    'Flood · Atlantis',
    'Earthquake · Atlantis',
    'Volcano · Atlantis',
    'Wildfire · Atlantis',
    'Drought · Atlantis',
  ])

  await page.getByLabel('Earthquakes').uncheck()
  await page.getByLabel('Droughts').uncheck()
  await expect(listed(page)).not.toContainText(['Earthquake in Atlantis'])
  await expect(listed(page)).toHaveCount(4)
  await page.getByLabel('Earthquakes').check()
  await expect(listed(page)).toHaveCount(5)
})

test('an earthquake’s card says what kind of event it is and what its shading means', async ({ page }) => {
  const geometry: string[] = []
  await page.route('**/api/events', (r) =>
    r.fulfill({ json: { fetchedAt: new Date().toISOString(), days: 10, type: 'FeatureCollection', features: events } }),
  )
  await page.route(/\/api\/events\/EQ\/3\/1\/geometry/, (r) => {
    geometry.push(r.request().url())
    return r.fulfill({ json: { type: 'FeatureCollection', features: [] } })
  })
  await page.goto('/')

  await page.locator('.events button', { hasText: 'Earthquake in Atlantis' }).click()
  await expect(page.locator('.cesium-infoBox-title')).toHaveText('Earthquake in Atlantis')
  const card = page.frameLocator('.cesium-infoBox-iframe')
  await expect(card.getByRole('row', { name: /Type/ })).toContainText('Earthquake')
  await expect(card.getByText(/where shaking was strong/)).toBeVisible()
  await expect.poll(() => geometry.length).toBeGreaterThan(0)
})

test('a watch area can choose any hazard type, and its summary names them', async ({ page }) => {
  await page.route('**/api/events', (r) =>
    r.fulfill({ json: { fetchedAt: new Date().toISOString(), days: 10, type: 'FeatureCollection', features: [] } }),
  )
  await page.goto('/')
  await page.getByRole('tab', { name: 'My alerts' }).click()
  await page.getByRole('button', { name: '+ Add area' }).click()
  await page.getByRole('button', { name: 'Use my location' }).click()
  await page.getByLabel('Name').fill('Home')

  const editor = page.locator('form.editor')
  for (const label of ['Tropical cyclones', 'Floods', 'Earthquakes', 'Volcanoes', 'Wildfires', 'Droughts']) {
    await expect(editor.getByLabel(label)).toBeVisible()
  }
  await expect(editor.getByText(/Earthquake alerts come after the shaking/)).toHaveCount(0)
  await editor.getByLabel('Earthquakes').check()
  await expect(editor.getByText(/Earthquake alerts come after the shaking/)).toBeVisible()
  await editor.getByLabel('Floods').uncheck()
  await page.getByRole('button', { name: 'Add area', exact: true }).click()

  await expect(page.getByRole('listitem').filter({ hasText: 'Home' })).toContainText('Storms and earthquakes, orange and red')
})
