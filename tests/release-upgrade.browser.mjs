import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'

const [baseline, personalFile, legacyFile, studyFile] = process.argv.slice(2)
assert(baseline && personalFile && legacyFile && studyFile, 'Pass the previous production shell, v2, v1, and study files.')
const pack = JSON.parse(await readFile(studyFile, 'utf8'))
const published = resolve(baseline)
const candidate = resolve('dist')
const scope = '/german-quiz/'
const types = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }
let updated = false
const requests = []
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname
  requests.push({ method: request.method, path })
  if (request.method !== 'GET' || !path.startsWith(scope)) return response.writeHead(404).end()
  const file = path.slice(scope.length) || 'index.html'
  if (!/^(?:assets\/)?[\w.-]+\.(?:js|css|html|svg|png|webmanifest)$/u.test(file) || file.includes('..')) {
    return response.writeHead(404).end()
  }
  try {
    const data = await readFile(join(updated ? candidate : published, file))
    const ext = file.slice(file.lastIndexOf('.'))
    response.writeHead(200, { 'Content-Type': types[ext], 'Cache-Control': 'no-store' }).end(data)
  } catch {
    response.writeHead(404).end()
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = 'http://127.0.0.1:' + server.address().port + scope
let browser
try {
  browser = await chromium.launch(process.env.GERMAN_QUIZ_BROWSER
    ? { executablePath: process.env.GERMAN_QUIZ_BROWSER } : { channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true,
    hasTouch: true, colorScheme: 'light' })
  const foreign = []
  await context.route('**/*', route => {
    const request = route.request()
    if (new URL(request.url()).origin === new URL(url).origin && request.method() === 'GET') return route.continue()
    foreign.push(request.method())
    return route.abort()
  })
  const page = await context.newPage()
  await page.goto(url)
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  await page.getByRole('heading', { name: 'ابدأ باستيراد مفرداتك' }).waitFor()
  await page.locator('input[type=file]').setInputFiles(legacyFile)
  await page.getByRole('heading', { name: 'ملف المفردات الشخصي' }).waitFor()
  await page.locator('input[type=file]').setInputFiles(personalFile)
  const format = new Intl.NumberFormat('ar-u-nu-arab')
  const personal = JSON.parse(await readFile(personalFile, 'utf8'))
  await page.getByText(format.format(personal.entries.length) + ' مفردة مستوردة', { exact: false }).waitFor()
  const screenshots = process.env.GERMAN_QUIZ_SCREENSHOTS
  async function capture(stage) {
    if (!screenshots) return
    await mkdir(screenshots, { recursive: true })
    await page.evaluate(() => scrollTo(0, 0))
    await page.screenshot({ path: join(screenshots, stage + '-mobile.png'), animations: 'disabled' })
    await page.setViewportSize({ width: 1440, height: 980 })
    const customization = page.locator('.activity-picker summary')
    const didExpand = await customization.count() && await customization.locator('..').getAttribute('open') === null
    if (didExpand) await customization.click()
    await page.evaluate(() => scrollTo(0, 0))
    await page.screenshot({ path: join(screenshots, stage + '-desktop.png'), animations: 'disabled' })
    if (didExpand) await customization.click()
    await page.setViewportSize({ width: 390, height: 844 })
  }
  await capture('before')
  await page.getByRole('link', { name: 'مركز الدراسة' }).click()
  await page.locator('#study-import').setInputFiles(studyFile)
  await page.getByText('فصلًا محمّلًا', { exact: false }).waitFor()
  await page.getByLabel('نوع التدريب', { exact: true }).selectOption('flashcard')
  await page.getByRole('button', { name: 'ابدأ التدريب', exact: true }).click()
  await page.getByRole('button', { name: 'اقلب البطاقة' }).click()
  await page.getByRole('button', { name: 'أحتاج إلى مراجعتها' }).click()
  await page.getByRole('status').filter({ hasText: 'بطاقة للمراجعة' }).waitFor()
  await page.getByRole('link', { name: 'اختبار المفردات', exact: true }).first().click()
  await page.locator('select').nth(0).selectOption('A1')
  await page.locator('select').nth(1).selectOption('20')
  await page.locator('select').nth(2).selectOption('with-automatic')
  await page.getByRole('button', { name: 'تفعيل الوضع الداكن' }).click()
  await page.getByRole('button', { name: 'ابدأ اختبارًا عشوائيًا' }).click()
  await page.locator('.choice').first().click()
  await page.getByRole('button', { name: 'السؤال التالي', exact: true }).waitFor()
  const snapshot = async () => page.evaluate(async () => {
    async function read(name, store, key) {
      const request = indexedDB.open(name, 1)
      const database = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      try {
        return await new Promise((resolve, reject) => {
          const request = database.transaction(store).objectStore(store).get(key)
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
      } finally {
        database.close()
      }
    }
    const local = Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith('german-quiz:') &&
      key !== 'german-quiz:practice-preferences')
      .map(key => [key, localStorage.getItem(key)]))
    return { local, active: await read('german-quiz-personal', 'vocabulary', 'active'),
      backup: await read('german-quiz-personal', 'vocabulary', 'backup-v1'),
      pack: await read('german-quiz-study', 'study', 'pack'),
      progress: await read('german-quiz-study', 'study', 'progress') }
  })
  const before = await snapshot()
  assert.equal(before.active.entries.length, personal.entries.length)
  assert.equal(before.backup.version, 1)
  assert.deepEqual(before.pack, pack)
  assert.equal(before.progress.length, 1)
  assert(Object.values(before.local).some(value => value?.includes('"answers":[') && !value.includes('"answers":[]')))
  assert.equal(before.local['german-quiz:theme'], 'dark')

  updated = true
  await page.evaluate(async () => (await navigator.serviceWorker.ready).update())
  await page.getByRole('button', { name: 'تثبيت تحديث التطبيق' }).waitFor()
  const reload = page.waitForEvent('load')
  await page.getByRole('button', { name: 'تثبيت تحديث التطبيق' }).click()
  await reload
  await page.getByRole('link', { name: 'التدريب', exact: true }).waitFor()
  await page.getByRole('button', { name: 'السؤال التالي', exact: true }).waitFor()
  assert.deepEqual(await snapshot(), before)
  await context.setOffline(true)
  await page.reload()
  await page.getByRole('button', { name: 'السؤال التالي', exact: true }).waitFor()
  assert.deepEqual(await snapshot(), before)

  await page.getByRole('link', { name: 'التدريب', exact: true }).click()
  await page.getByRole('button', { name: 'ابدأ التدريب', exact: true }).waitFor()
  assert(await page.getByRole('radio', { name: 'A1+', exact: true }).isChecked())
  assert(await page.getByRole('radio', { name: '٢٠', exact: true }).isChecked())
  await page.getByRole('link', { name: 'التقدّم', exact: true }).click()
  await page.getByRole('button', { name: /^البطاقات المستحقّة/u }).waitFor()
  await page.getByRole('link', { name: 'تابع اختبار المفردات المحفوظ', exact: true }).waitFor()
  await page.getByRole('link', { name: 'الإعدادات', exact: true }).click()
  await page.getByRole('button', { name: 'فاتح', exact: true }).click()
  await page.getByRole('link', { name: 'التدريب', exact: true }).click()
  await page.getByRole('radio', { name: 'A1+ & A2+', exact: true }).check()
  await page.getByRole('radio', { name: '١٠', exact: true }).check()
  await capture('after')

  await page.setViewportSize({ width: 320, height: 700 })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.locator('.chapter-picker summary').click()
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'BUTTON')
  await page.getByRole('button', { name: 'مسح التحديد', exact: true }).click()
  assert(await page.getByRole('button', { name: 'ابدأ التدريب', exact: true }).isDisabled())
  await page.getByRole('button', { name: 'تحديد الكل', exact: true }).click()
  assert.equal(await page.locator('.chapter-picker input:checked').count(), 24)

  await page.evaluate(() => { location.hash = '/study' })
  await page.getByRole('heading', { name: 'ماذا تريد أن تتدرّب عليه؟' }).waitFor()
  assert.deepEqual(foreign, [])
  assert(requests.every(request => request.method === 'GET'))
  console.log('Same-origin offline upgrade preserved v1 backup, v2 vocabulary, all 24 study chapters, recorded study and vocabulary progress, and legacy bookmarks.')
} finally {
  await browser?.close()
  server.close()
}
