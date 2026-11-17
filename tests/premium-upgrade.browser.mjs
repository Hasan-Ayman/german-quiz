import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { chromium } from 'playwright-core'

const baseline = process.argv[2]
const privateFile = process.argv[3] ?? process.env.GERMAN_QUIZ_EDUCATION_TEST_FILE
assert(baseline && privateFile, 'Pass the baseline build and the current local education file.')
const education = JSON.parse(await readFile(privateFile, 'utf8'))
const scope = '/german-quiz/'
const mime = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json' }
let updated = false
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname
  if (request.method !== 'GET' || !path.startsWith(scope)) return response.writeHead(404).end()
  const file = path.slice(scope.length) || 'index.html'
  if (!/^(?:assets\/)?[\w.-]+\.(?:js|css|html|svg|png|webmanifest)$/u.test(file)) return response.writeHead(404).end()
  try {
    const bytes = await readFile(join(resolve(updated ? 'dist' : baseline), file))
    response.writeHead(200, { 'Content-Type': mime[extname(file)], 'Cache-Control': 'no-store' }).end(bytes)
  } catch { response.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = 'http://127.0.0.1:' + server.address().port + scope
let browser
try {
  browser = await chromium.launch(process.env.GERMAN_QUIZ_BROWSER
    ? { executablePath: process.env.GERMAN_QUIZ_BROWSER } : { channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const blocked = []
  await context.route('**/*', route => {
    const request = route.request()
    if (request.method() === 'GET' && new URL(request.url()).origin === new URL(url).origin) return route.continue()
    blocked.push(request.url())
    return route.abort()
  })
  await context.addInitScript(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (value, key) {
      const request = put.call(this, value, key)
      if (key === 'practice-position-v2' && sessionStorage.getItem('test-premium-abort')) {
        sessionStorage.removeItem('test-premium-abort')
        this.transaction.abort()
      }
      return request
    }
  })
  const page = await context.newPage()
  const heading = name => page.getByRole('heading', { name, exact: true })
  const snapshot = () => page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const opening = indexedDB.open('german-quiz-study', 1)
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error)
    })
    try {
      const keys = ['education', 'progress', 'practice-plan', 'practice-position', 'practice-plan-v2', 'practice-position-v2']
      const store = db.transaction('study', 'readonly').objectStore('study')
      const values = await Promise.all(keys.map(key => new Promise((resolve, reject) => {
        const read = store.get(key)
        read.onsuccess = () => resolve(read.result ?? null)
        read.onerror = () => reject(read.error)
      })))
      return Object.fromEntries(keys.map((key, index) => [key, values[index]]))
    } finally { db.close() }
  })
  await page.goto(url + '#/settings')
  await page.locator('#education-file').setInputFiles(privateFile)
  await page.getByText('تم استيراد المحتوى التعليمي وحفظه على هذا الجهاز.', { exact: true }).waitFor()
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  const essay = education.study.questions.find(item => item.type === 'writing')
  const exercise = education.study.questions.find(item => item.type === 'cloze' && item.chapter === essay.chapter)
  assert(essay && exercise)
  await page.evaluate(async ({ essay, exercise }) => {
    const db = await new Promise(resolve => {
      const open = indexedDB.open('german-quiz-study', 1)
      open.onsuccess = () => resolve(open.result)
    })
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction('study', 'readwrite')
        const store = transaction.objectStore('study')
        store.put({ id: 'premium-legacy-plan', items: [essay, exercise] }, 'practice-plan')
        store.put({ id: 'premium-legacy-plan', index: 0, results: ['completed'], response: 'Legacy draft retained' }, 'practice-position')
        store.put([{ id: 'premium-legacy-history', type: 'writing', result: 'completed',
          questionId: essay.id, chapter: essay.chapter, topic: essay.topic, time: Date.now() - 3600000 }], 'progress')
        transaction.oncomplete = resolve
        transaction.onabort = () => reject(transaction.error)
      })
    } finally { db.close() }
    sessionStorage.setItem('test-premium-abort', '1')
  }, { essay, exercise })
  const before = await snapshot()
  assert(isDeepStrictEqual(before.education.content, education), 'Original unified education must be retained exactly')

  updated = true
  await page.evaluate(async () => (await navigator.serviceWorker.ready).update())
  await page.getByRole('button', { name: 'تثبيت تحديث التطبيق', exact: true }).waitFor()
  const load = page.waitForEvent('load')
  await page.getByRole('button', { name: 'تثبيت تحديث التطبيق', exact: true }).click()
  await load
  await page.getByRole('alert').filter({ hasText: 'تعذّر فتح جلسة التدريب المحفوظة.' }).waitFor()
  assert(isDeepStrictEqual(await snapshot(), before), 'A failed session migration must roll back both new records')

  await context.setOffline(true)
  await page.reload()
  await page.locator('.education-counts').waitFor()
  await page.getByRole('link', { name: 'الرئيسية', exact: true }).click()
  await heading('تقدّمك في الألمانية').waitFor()
  await page.getByRole('link', { name: 'تابع آخر جلسة', exact: true }).click()
  await page.getByRole('progressbar', { name: 'تقدم الجلسة', exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: 'اكتب بالألمانية' }).count(), 0)
  const after = await snapshot()
  for (const key of ['education', 'progress', 'practice-plan', 'practice-position']) {
    assert(isDeepStrictEqual(after[key], before[key]), key + ' must remain byte-for-byte equivalent in content')
  }
  assert.equal(after['practice-plan-v2'].items.length, 1)
  assert.equal(after['practice-plan-v2'].items[0].id, exercise.id)
  assert.equal(after['practice-position-v2'].response, '')
  assert.deepEqual(blocked, [])
  console.log('Unified-import offline upgrade: old data and writing retained, one forced rollback, and resumed active practice without writing.')
} finally {
  await browser?.close()
  server.close()
}
