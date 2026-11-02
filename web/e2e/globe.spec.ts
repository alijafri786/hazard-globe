import { expect, test } from '@playwright/test'
import { searchGlobe, stubHazardData, stubNominatim } from './stubs'

test('the info box closes from its × (Cesium’s scene mode picker used to swallow the click)', async ({ page }) => {
  await stubHazardData(page)
  await stubNominatim(page)
  await page.goto('/')
  await searchGlobe(page, '48.8566, 2.3522')
  await expect(page.locator('.cesium-infoBox-title')).toHaveText('48.8566° N, 2.3522° E')
  await page.locator('.cesium-infoBox-close').click()
  await expect(page.locator('.cesium-infoBox-title')).not.toBeVisible()
})

test('switching to 2D, Columbus view and back to 3D keeps the globe rendering', async ({ page }) => {
  await stubHazardData(page)
  await page.goto('/')
  const picker = page.locator('.cesium-sceneModePicker-wrapper > button').first()
  for (const mode of ['2D', 'Columbus View', '3D']) {
    await picker.click()
    await page.getByRole('button', { name: mode, exact: true }).last().click()
    await expect(picker).toHaveAttribute('title', mode)
    await expect(page.locator('.cesium-widget-errorPanel')).toHaveCount(0)
  }
})
