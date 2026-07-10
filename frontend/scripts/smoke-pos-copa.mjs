// Smoke test manual da página /pos-copa — mobile (iPhone 13), via Playwright.
// Não faz parte de um runner de testes (projeto não tem um ainda); rodar à mão:
//
//   npm install playwright --no-save   (1x, se não tiver instalado)
//   npx playwright install chromium    (1x)
//   node scripts/smoke-pos-copa.mjs [baseUrl]   (default: http://localhost:5180)
//
// Precisa do dev server rodando (`npm run dev -- --port 5180`).
// Gera screenshots em /tmp/poscopa-*.png e reporta erros de console/página.

import { chromium, devices } from 'playwright'

const baseUrl = process.argv[2] || 'http://localhost:5180'
const iphone = devices['iPhone 13']
const browser = await chromium.launch({ args: ['--no-sandbox'] })
const context = await browser.newContext({ ...iphone })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()) })

await page.goto(`${baseUrl}/pos-copa`, { waitUntil: 'networkidle', timeout: 30000 })
await page.waitForSelector('text=Predicts.info continua depois da Copa', { timeout: 15000 })

// fecha overlays globais do app (onboarding / banner de update) que não são da pos-copa
const pular = page.locator('text=Pular')
if (await pular.count()) await pular.click().catch(() => {})
await page.waitForTimeout(300)
const closeBanner = page.locator('button:has-text("×")').first()
if (await closeBanner.count()) await closeBanner.click().catch(() => {})
await page.waitForTimeout(300)

await page.screenshot({ path: '/tmp/poscopa-mobile-hero.png' })

const h = await page.evaluate(() => document.body.scrollHeight)
for (const [i, frac] of [0.22, 0.38, 0.5, 0.62, 0.75, 0.88, 1].entries()) {
  await page.evaluate((y) => window.scrollTo(0, y), h * frac)
  await page.waitForTimeout(250)
  await page.screenshot({ path: `/tmp/poscopa-mobile-${i + 2}.png` })
}

const filterBtn = page.locator('.pc-lb-filter', { hasText: 'Brasileirão' })
if (await filterBtn.count()) await filterBtn.click().catch((e) => errors.push('filter click: ' + e.message))

const pollBtn = page.locator('.pc-poll__option', { hasText: 'Libertadores' })
if (await pollBtn.count()) {
  await pollBtn.scrollIntoViewIfNeeded()
  await pollBtn.click().catch((e) => errors.push('poll click: ' + e.message))
  await page.waitForTimeout(200)
  await page.screenshot({ path: '/tmp/poscopa-mobile-poll.png' })
}

const bodyWidth = await page.evaluate(() => document.documentElement.scrollWidth)
const viewportWidth = await page.evaluate(() => window.innerWidth)

console.log('ERRORS:', JSON.stringify(errors, null, 2))
console.log('TITLE:', await page.title())
console.log('scrollWidth vs viewport (overflow check):', bodyWidth, viewportWidth)

await browser.close()
