import { expect, test, type Page } from '@playwright/test'
import { stubHazardData } from './stubs'

const list = (page: Page) => page.getByRole('dialog', { name: 'Layers' })
const key = (page: Page) => page.getByRole('complementary', { name: 'Map key' })

async function open(page: Page) {
  await stubHazardData(page)
  // Nothing in these tests should reach NOAA, USGS or CelesTrak
  await page.route(/\/api\/weather\/wind/, (r) => r.fulfill({ status: 503, json: { error: 'stub' } }))
  await page.route(/\/api\/satellites\//, (r) =>
    r.fulfill({ json: { group: 'stations', fetchedAt: new Date().toISOString(), satellites: [] } }),
  )
  await page.route(/\/api\/earthquakes/, (r) =>
    r.fulfill({ json: { feed: 'day', fetchedAt: new Date().toISOString(), generatedAt: null, quakes: [] } }),
  )
  await page.goto('/')
  await page.getByRole('button', { name: /^Layers/ }).click()
  await expect(list(page)).toBeVisible()
}

test('the layer list and the tabs switch the same layers', async ({ page }) => {
  await open(page)
  await expect(page.getByRole('button', { name: /^Layers/ })).toContainText('6') // the six GDACS types

  await list(page).getByLabel('Floods').uncheck()
  await list(page).getByLabel('Wind').check()
  await expect(page.getByRole('button', { name: /^Layers/ })).toContainText('6')
  await page.keyboard.press('Escape')
  await expect(list(page)).toHaveCount(0)

  // the Events tab's own toggle followed
  await expect(page.locator('.toggles').getByLabel('Floods')).not.toBeChecked()
  await page.getByRole('tab', { name: 'Weather' }).click()
  await expect(page.getByLabel('Show wind, moving')).toBeChecked()

  // and the other way round
  await page.getByLabel('Show wind, moving').uncheck()
  await page.getByRole('button', { name: /^Layers/ }).click()
  await expect(list(page).getByLabel('Wind')).not.toBeChecked()
})

test('the key follows what is on the globe, and live layers leave it while looking back', async ({ page }) => {
  await open(page)
  await expect(key(page)).toContainText('GDACS events')
  await expect(key(page)).toContainText('GDACS alert level')
  await expect(key(page)).not.toContainText('Earthquakes by depth')

  await list(page).getByLabel('Earthquakes, live (USGS)').check()
  await list(page).getByLabel('Wind').check()
  await expect(key(page)).toContainText('Earthquakes by depth (USGS)')
  await expect(key(page)).toContainText('Wind')

  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'History' }).click()
  await expect(key(page)).not.toContainText('Earthquakes by depth')
  await expect(key(page)).not.toContainText('Wind')
  await expect(key(page)).toContainText('GDACS events') // dated, so still shown

  await page.getByRole('button', { name: /^Layers/ }).click()
  await expect(list(page)).toContainText('Looking back')
})

test('“Events only” switches everything else off, and a click elsewhere closes the list', async ({ page }) => {
  await open(page)
  await list(page).getByLabel('Droughts').uncheck()
  await list(page).getByLabel('Wind').check()
  await list(page).getByLabel('Satellites').check()
  await list(page).getByRole('button', { name: 'Events only' }).click()

  for (const label of ['Wind', 'Satellites', 'Flights', 'Clouds']) await expect(list(page).getByLabel(label)).not.toBeChecked()
  await expect(list(page).getByLabel('Droughts')).toBeChecked()

  await page.mouse.click(900, 450) // the globe
  await expect(list(page)).toHaveCount(0)
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('the layer list fits on screen with the panel folded', async ({ page }) => {
    await open(page) // opens the list…
    await page.keyboard.press('Escape')
    await page.locator('.panel .grip').click() // …folds the panel
    await page.getByRole('button', { name: /^Layers/ }).click()
    const box = (await list(page).boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(844)
    await list(page).getByLabel('Satellites').check()
    await expect(list(page).getByLabel('Satellites')).toBeChecked()
  })

  test('the key sits clear of the History badge', async ({ page }) => {
    await open(page)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'History' }).click()
    const badge = (await page.getByRole('status').filter({ hasText: 'History ·' }).boundingBox())!
    const keyBox = (await key(page).boundingBox())!
    expect(keyBox.y).toBeGreaterThanOrEqual(badge.y + badge.height)
  })

  test('embedded, the key opens rather than the full app', async ({ page }) => {
    await stubHazardData(page)
    await page.goto('/?embed=1')
    const fold = key(page).getByRole('button', { name: /Key/ })
    await fold.click()
    await expect(fold).toHaveAttribute('aria-expanded', 'true')
  })
})
