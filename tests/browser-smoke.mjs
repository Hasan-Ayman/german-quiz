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
const fixtureName = 'german-quiz-personal-vocabulary-v' + personal.version + '.json'
const legacyFile = process.argv[3] ? await readFile(process.argv[3]) : null
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
  await page.getByRole('alert').filter({ hasText: 'بنية JSON غير صالحة' }).waitFor()
  if (legacyFile) {
    await page.locator('input[type=file]').setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: legacyFile })
    await page.getByRole('heading', { name: vocabularySection }).waitFor()
  }
  await page.locator('input[type=file]').setInputFiles({ name: fixtureName, mimeType: 'application/json', buffer: importBuffer })
  await page.getByRole('heading', { name: vocabularySection }).waitFor()
  await page.waitForFunction(count => document.querySelector('.vocabulary-file')?.textContent?.includes(count),
    locale.format(personal.entries.length))
  assert((await page.locator('.vocabulary-file').innerText()).includes(locale.format(personal.entries.length)))
  if (legacyFile) {
    const backup = await page.evaluate(async () => {
      const request = indexedDB.open('german-quiz-personal')
      const database = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      try {
        return await new Promise((resolve, reject) => {
          const read = database.transaction('vocabulary').objectStore('vocabulary').get('backup-v1')
          read.onsuccess = () => resolve(read.result)
          read.onerror = () => reject(read.error)
        })
      } finally {
        database.close()
      }
    })
    const old = JSON.parse(legacyFile)
    assert.equal(backup.version, 1)
    assert.deepEqual(backup.entries.map(entry => entry.id), old.entries.map(entry => entry.id))
    assert.deepEqual(backup.entries.flatMap(entry => entry.examples), old.entries.flatMap(entry => entry.examples))
  }
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
  await page.getByRole('alert').filter({ hasText: 'إصداره غير مدعوم' }).waitFor()
  assert.equal(await safeCount.textContent(), expandedA2)

  for (const failure of ['quota', 'abort']) {
    await page.evaluate(mode => {
      const put = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (value, key) {
        if (key === 'active') {
          IDBObjectStore.prototype.put = put
          if (mode === 'quota') throw new DOMException('Test quota', 'QuotaExceededError')
          const request = put.call(this, value, key)
          this.transaction.abort()
          return request
        }
        return put.call(this, value, key)
      }
    }, failure)
    const replacement = Buffer.from(JSON.stringify({ ...personal, replacementMarker: true }))
    await page.locator('input[type=file]').setInputFiles({ name: fixtureName, mimeType: 'application/json', buffer: replacement })
    await page.getByRole('alert').filter({
      hasText: failure === 'quota' ? 'مساحة التخزين في المتصفح غير كافية' : 'تعذّر حفظ الملف في المتصفح',
    }).waitFor()
    await page.reload()
    await page.getByRole('heading', { name: vocabularySection }).waitFor()
    assert.equal(await safeCount.textContent(), expandedA2)
  }

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
  let expectedExample = false
  for (let attempt = 0; attempt < 18 && !expectedExample; attempt++) {
    await page.locator('.choice').first().click()
    expectedExample = await page.locator('.example-feedback p[lang=de][dir=ltr]').count() > 0 &&
      await page.locator('.example-feedback p[lang=ar][dir=rtl]').count() > 0
    if (!expectedExample) await page.getByRole('button', { name: 'السؤال التالي' }).click()
  }
  assert(expectedExample)
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  if (personal.version === 2) {
    await page.getByRole('link', { name: 'الرئيسية', exact: true }).click()
    await page.getByRole('link', { name: 'مراجعة المفردات', exact: true }).click()
    await page.getByRole('searchbox').fill(personal.entries[0].german)
    await page.locator('.example-feedback p[lang=de][dir=ltr]').first().waitFor()
    await page.locator('.example-feedback p[lang=ar][dir=rtl]').first().waitFor()
    await page.getByRole('link', { name: 'الرئيسية', exact: true }).click()
    await page.getByText('أنواع الأسئلة', { exact: true }).click()
    await page.getByRole('button', { name: 'إلغاء الاختيار' }).click()
    await page.getByRole('checkbox', { name: 'الجمع', exact: true }).check()
    await page.getByText('الفصول', { exact: true }).click()
    await page.getByRole('checkbox', { name: /^A2 · 1\./u }).check()
    await page.getByRole('button', { name: 'ابدأ اختبارًا عشوائيًا' }).click()
    await page.getByText('اختر صيغة الجمع كما وردت في المصدر', { exact: true }).waitFor()
  }

  if (process.env.GERMAN_QUIZ_STUDY_AUDIT) {
    const path = join(process.env.GERMAN_QUIZ_STUDY_AUDIT, 'german-quiz-study-private.json')
    await page.getByRole('link', { name: 'مركز الدراسة', exact: true }).click()
    await page.getByRole('heading', { name: 'مركز الدراسة' }).waitFor()
    await page.getByText('استورد ملف حزمة الدراسة لعرض الفصول والأنشطة.', { exact: false }).waitFor()
    await page.locator('#study-import').setInputFiles(path)
    await page.getByText('فصلًا محمّلًا', { exact: false }).waitFor()
    await page.getByLabel('الفصل', { exact: true }).selectOption('A2:12')
    await page.getByRole('heading', { name: JSON.parse(await readFile(path, 'utf8')).chapters.find(item => item.id === 'A2:12').title }).waitFor()
    await page.getByRole('button', { name: 'التدريب الحر', exact: true }).click()
    await page.getByLabel('المستوى', { exact: true }).selectOption('A1')
    await page.getByLabel('نوع التدريب', { exact: true }).selectOption('reading')
    await page.getByRole('status').filter({ hasText: '١٢ نشاطًا' }).waitFor()
    await page.reload()
    await page.getByLabel('الفصل', { exact: true }).waitFor()
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.getByRole('link', { name: 'اختبار المفردات', exact: true }).click()
    await page.getByRole('heading', { name: vocabularySection }).waitFor()
    console.log('Private study import, chapter navigation, filtering, offline persistence and vocabulary compatibility passed.')
  }

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
