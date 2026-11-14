// Opens the running dev server in the installed Chrome and saves a screenshot.
// Usage: node scripts/screenshot.mjs <url> <out.png> [width] [height] [scrollToPage] [clickSelector]
import { chromium } from 'playwright-core'

const [url, out, width = '1000', height = '1400', scrollToPage, click] = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({
  viewport: { width: Number(width), height: Number(height) },
  deviceScaleFactor: 2,
})
page.on('console', (message) => console.log(`[${message.type()}]`, message.text()))
page.on('response', (r) => r.status() >= 400 && console.log('[http]', r.status(), r.url()))
page.on('pageerror', (error) => console.log('[pageerror]', error.message))
await page.goto(url)
await page.waitForSelector('.page canvas', { timeout: 20000 })
if (scrollToPage) {
  await page.locator(`[data-page="${scrollToPage}"]`).scrollIntoViewIfNeeded()
  await page.waitForSelector(`[data-page="${scrollToPage}"] canvas`, { timeout: 20000 })
}
await page.waitForTimeout(800)
if (click) {
  await page.locator(click).first().click()
  await page.waitForTimeout(300)
}
console.log('summaries on screen:', await page.locator('.block-summary').count())
await page.screenshot({ path: out })
await browser.close()
