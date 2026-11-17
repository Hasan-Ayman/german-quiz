import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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
    const local = Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith('german-quiz:'))
      .map(key => [key, localStorage.getItem(key)]))
    return { local, active: await read('german-quiz-personal', 'vocabulary', 'active'),
      backup: await read('german-quiz-personal', 'vocabulary', 'backup-v1') }
  })
  const before = await snapshot()
  assert.equal(before.active.entries.length, personal.entries.length)
  assert.equal(before.backup.version, 1)
  assert(Object.values(before.local).some(value => value?.includes('"answers":[') && !value.includes('"answers":[]')))
  assert.equal(before.local['german-quiz:theme'], 'dark')

  updated = true
  await page.evaluate(async () => (await navigator.serviceWorker.ready).update())
  await page.getByRole('button', { name: 'تثبيت تحديث التطبيق' }).waitFor()
  const reload = page.waitForEvent('load')
  await page.getByRole('button', { name: 'تثبيت تحديث التطبيق' }).click()
  await reload
  await page.getByRole('link', { name: 'مركز الدراسة', exact: true }).waitFor()
  await page.getByRole('button', { name: 'السؤال التالي', exact: true }).waitFor()
  assert.deepEqual(await snapshot(), before)

  await context.setOffline(true)
  await page.reload()
  await page.getByRole('button', { name: 'السؤال التالي', exact: true }).waitFor()
  assert.deepEqual(await snapshot(), before)
  await page.getByRole('link', { name: 'مركز الدراسة', exact: true }).click()
  await page.getByText('استورد ملف حزمة الدراسة لعرض الفصول والأنشطة.', { exact: false }).waitFor()
  await page.locator('#study-import').setInputFiles(studyFile)
  await page.getByText(format.format(pack.chapters.length) + ' فصلًا محمّلًا', { exact: false }).waitFor()
  await page.reload()
  await page.getByText(format.format(pack.chapters.length) + ' فصلًا محمّلًا', { exact: false }).waitFor()
  await page.locator('#study-import').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{}') })
  await page.getByRole('alert').filter({ hasText: 'تعذّر استيراد الحزمة' }).waitFor()
  await page.reload()
  await page.getByText(format.format(pack.chapters.length) + ' فصلًا محمّلًا', { exact: false }).waitFor()
  const storedPack = await page.evaluate(async () => {
    const request = indexedDB.open('german-quiz-study', 1)
    const database = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise((resolve, reject) => {
        const request = database.transaction('study').objectStore('study').get('pack')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    } finally {
      database.close()
    }
  })
  assert.deepEqual(storedPack, pack)

  for (const chapter of ['A1:1', 'A2:8']) {
    await page.getByLabel('الفصل', { exact: true }).selectOption(chapter)
    const lesson = pack.chapters.find(item => item.id === chapter)
    await page.getByRole('heading', { name: lesson.title, exact: true }).waitFor()
    const drill = pack.questions.find(item => item.chapter === chapter && item.type === 'reading')
    await page.getByLabel('نوع التدريب', { exact: true }).selectOption('reading')
    await page.getByRole('button', { name: 'ابدأ التدريب' }).click()
    await page.getByRole('button', { name: drill.answers[0], exact: true }).click()
    await page.getByRole('status').filter({ hasText: 'إجابة صحيحة' }).waitFor()
    await page.getByRole('button', { name: 'العودة إلى الإعدادات' }).click()
    await page.getByRole('button', { name: 'التدريب الحر', exact: true }).click()
    await page.getByLabel('المستوى', { exact: true }).selectOption(chapter.split(':')[0])
    await page.getByText('الفصول', { exact: true }).click()
    await page.getByRole('checkbox', { name: new RegExp('^' + chapter + ' ·') }).check()
    await page.getByRole('button', { name: 'ابدأ التدريب' }).click()
    await page.getByRole('button', { name: drill.answers[0], exact: true }).click()
    await page.getByRole('status').filter({ hasText: 'إجابة صحيحة' }).waitFor()
    await page.getByRole('button', { name: 'العودة إلى الإعدادات' }).click()
    await page.getByRole('button', { name: 'الدراسة حسب الفصل', exact: true }).click()
  }
  const variant = pack.questions.find(item => item.type === 'reading' && item.answers.length > 1)
  if (variant) {
    await page.getByLabel('الفصل', { exact: true }).selectOption(variant.chapter)
    await page.getByLabel('نوع التدريب', { exact: true }).selectOption('reading')
    await page.getByRole('button', { name: 'ابدأ التدريب' }).click()
    await page.getByRole('button', { name: 'كتابة الإجابة' }).click()
    await page.getByLabel('إجابتك').fill(variant.answers[1])
    await page.getByRole('button', { name: 'تحقق من الإجابة' }).click()
    await page.getByRole('status').filter({ hasText: 'إجابة صحيحة' }).waitFor()
  }
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  assert.deepEqual(await snapshot(), before)
  assert.deepEqual(foreign, [])
  assert(requests.every(request => request.method === 'GET'))
  console.log('Same-origin deployed-shell upgrade preserved the full v2 library, v1 backup, theme, settings and answered quiz. Offline study import, malformed rollback, refresh and both study modes at both levels passed.')
} finally {
  await browser?.close()
  server.close()
}
