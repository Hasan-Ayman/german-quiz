import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { fixtureDataset } from './fixtures.ts'

const root = fileURLToPath(new URL('../dist/', import.meta.url))
const base = '/german-quiz/'
const fileTypes = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css',
  webmanifest: 'application/manifest+json', png: 'image/png', svg: 'image/svg+xml',
}
const assetPaths = (await readdir(join(root, 'assets'))).map(name => 'assets/' + name)
const filePaths = [...(await readdir(root)).filter(name => name !== 'assets'), ...assetPaths]
const files = new Map(await Promise.all(filePaths.map(async path => [path, await readFile(join(root, path))])))
const serverRequests = []
let updatedWorker = false
const server = createServer((request, response) => {
  const path = request.url?.split('?')[0]
  serverRequests.push({ method: request.method, url: request.url })
  const file = path === base ? 'index.html' : path?.startsWith(base) ? path.slice(base.length) : ''
  const data = files.get(file)
  if (!data) return response.writeHead(404).end()
  response.writeHead(200, { 'Content-Type': fileTypes[file.split('.').at(-1)], 'Cache-Control': 'no-store' })
  response.end(file === 'sw.js' && updatedWorker
    ? data.toString().replace(/(const shellCache = cachePrefix \+ "[a-f0-9]+)"/u, '$1-update"')
    : data)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

const personal = process.argv[2] ? JSON.parse(await readFile(process.argv[2], 'utf8')) : {
  ...fixtureDataset, entries: fixtureDataset.entries.map(entry => ({
    ...entry,
    examples: entry.examples.length ? entry.examples : [{
      entryId: entry.id, german: 'Dies ist ein Satz für die Testdatei.', arabic: 'هذه جملة لملف الاختبار.',
      level: entry.levels[0], origin: 'authored', verificationStatus: 'reviewed',
    }],
    incompleteExampleLevels: entry.examples.length ? entry.incompleteExampleLevels : [],
  })),
}
const importBuffer = Buffer.from(JSON.stringify(personal))
const fixtureName = 'german-quiz-personal-vocabulary-v1.json'
const appUrl = 'http://127.0.0.1:' + server.address().port + base
const origin = new URL(appUrl).origin
const vocabularySection = 'ملف المفردات الشخصي'
const locale = new Intl.NumberFormat('ar-u-nu-arab')
let browser
try {
  browser = await chromium.launch(process.env.GERMAN_QUIZ_BROWSER
    ? { executablePath: process.env.GERMAN_QUIZ_BROWSER } : { channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true,
    deviceScaleFactor: 2, hasTouch: true, acceptDownloads: true })
  const unexpectedRequests = []
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue()
    unexpectedRequests.push(route.request().url())
    return route.abort()
  })
  const page = await context.newPage()
  await page.goto(appUrl)
  await page.getByRole('heading', { name: 'ابدأ باستيراد مفرداتك' }).waitFor()
  await page.locator('input[type=file]').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{') })
  await page.getByRole('alert').waitFor()
  await page.locator('input[type=file]').setInputFiles({ name: fixtureName, mimeType: 'application/json', buffer: importBuffer })
  await page.getByRole('heading', { name: vocabularySection }).waitFor()
  assert((await page.locator('.vocabulary-file').innerText()).includes(locale.format(personal.entries.length)))
  const safeCount = page.locator('#pilot-availability')
  const select = page.locator('select')
  await select.nth(0).selectOption('A1')
  const reviewedA1 = await safeCount.textContent()
  await select.nth(2).selectOption('with-automatic')
  const expandedA1 = await safeCount.textContent()
  await select.nth(0).selectOption('A2')
  const expandedA2 = await safeCount.textContent()
  if (process.argv[2]) assert.notEqual(reviewedA1, expandedA1)
  assert.notEqual(expandedA1, expandedA2)
  await select.nth(1).selectOption('50')
  await page.locator('input[type=file]').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('[]') })
  await page.getByRole('alert').waitFor()
  assert.equal(await safeCount.textContent(), expandedA2)

  const downloadStarted = page.waitForEvent('download')
  await page.getByRole('button', { name: 'تنزيل ملف المفردات' }).click()
  const download = await downloadStarted
  assert.equal(download.suggestedFilename(), fixtureName)
  const exported = await readFile(await download.path())
  assert.deepEqual(JSON.parse(exported), personal)

  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  const cachedFiles = await page.evaluate(async () => {
    const names = await caches.keys()
    const cache = await caches.open(names.find(name => name.startsWith('german-quiz-shell:')))
    return (await cache.keys()).map(request => new URL(request.url).pathname)
  })
  assert.equal(cachedFiles.length, filePaths.length - 1)
  assert(cachedFiles.every(path => filePaths.includes(path.slice(base.length))))

  updatedWorker = true
  await page.evaluate(async () => (await navigator.serviceWorker.ready).update())
  await page.getByRole('button', { name: 'تثبيت تحديث التطبيق' }).waitFor()
  const reloaded = page.waitForEvent('load')
  await page.getByRole('button', { name: 'تثبيت تحديث التطبيق' }).click()
  await reloaded
  await page.getByRole('heading', { name: vocabularySection }).waitFor()

  await context.setOffline(true)
  await page.reload()
  await page.getByRole('heading', { name: vocabularySection }).waitFor()
  assert.equal(await safeCount.textContent(), expandedA2)
  assert.equal(await select.nth(1).inputValue(), '50')
  await page.getByRole('button', { name: 'ابدأ اختبارًا عشوائيًا' }).click()
  assert.equal(await page.locator('.example-feedback').count(), 0)
  assert.match(await page.locator('.progress-area').innerText(), /٥٠/u)
  let bilingual = false
  for (let attempt = 0; attempt < 8 && !bilingual; attempt++) {
    await page.locator('.choice').first().click()
    bilingual = await page.locator('.example-feedback p[lang=de][dir=ltr]').count() === 1 &&
      await page.locator('.example-feedback p[lang=ar][dir=rtl]').count() === 1
    if (!bilingual) await page.getByRole('button', { name: 'السؤال التالي' }).click()
  }
  assert(bilingual)
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))

  const fresh = await browser.newContext({ viewport: { width: 1280, height: 850 } })
  const transferPage = await fresh.newPage()
  await transferPage.goto(appUrl)
  await transferPage.getByRole('heading', { name: 'ابدأ باستيراد مفرداتك' }).waitFor()
  await transferPage.locator('input[type=file]').setInputFiles({ name: fixtureName, mimeType: 'application/json', buffer: exported })
  await transferPage.getByRole('heading', { name: vocabularySection }).waitFor()
  assert((await transferPage.locator('.vocabulary-file').innerText()).includes(locale.format(personal.entries.length)))
  assert.deepEqual(unexpectedRequests, [])
  const shellPaths = new Set([base, ...filePaths.map(file => base + file)])
  assert(serverRequests.every(({ method, url }) => method === 'GET' && shellPaths.has(url)))
  console.log('Browser checks passed: missing dataset, invalid and valid imports, export and transfer, IndexedDB reload, scope, offline quiz, updates and responsive layout.')
} finally {
  await browser?.close()
  server.close()
}
