import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { educationFilename } from '../src/education-package.ts'

const packageFile = process.argv[2] ?? process.env.GERMAN_QUIZ_EDUCATION_TEST_FILE
assert(packageFile, 'Pass the local unified education JSON path to npm run test:browser.')
const importBuffer = await readFile(packageFile)
const fullPackage = JSON.parse(importBuffer)
const { vocabulary: personal, study: pack } = fullPackage

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

const appUrl = 'http://127.0.0.1:' + server.address().port + base
const origin = new URL(appUrl).origin
const educationSection = 'استيراد المحتوى التعليمي'
const importDone = 'تم استيراد المحتوى التعليمي وحفظه على هذا الجهاز.'
const chrome = process.env.GERMAN_QUIZ_BROWSER
  ? { executablePath: process.env.GERMAN_QUIZ_BROWSER } : { channel: 'chrome' }
const locale = new Intl.NumberFormat('ar-u-nu-arab')
let browser
try {
  browser = await chromium.launch(chrome)
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true,
    deviceScaleFactor: 2, hasTouch: true, acceptDownloads: true })
  const unexpectedRequests = []
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin && route.request().method() === 'GET') return route.continue()
    unexpectedRequests.push(route.request().url())
    return route.abort()
  })
  async function withProfile(profile, use) {
    const persistent = await chromium.launchPersistentContext(profile, chrome)
    try {
      await persistent.route('**/*', route => {
        const request = route.request()
        if (new URL(request.url()).origin === origin && request.method() === 'GET') return route.continue()
        unexpectedRequests.push(request.url())
        return route.abort()
      })
      await use(persistent, persistent.pages()[0] ?? await persistent.newPage())
    } finally {
      await persistent.close()
    }
  }
  const page = await context.newPage()
  page.setDefaultTimeout(10_000)
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.name))
  page.on('dialog', dialog => dialog.accept())
  const go = route => page.evaluate(name => { window.location.hash = '/' + name }, route)
  const shown = (text, options = {}) => page.getByText(text, { exact: true, ...options }).waitFor()
  const button = name => page.getByRole('button', { name, exact: true })
  const home = () => go('setup')
  const screenshotFolder = process.env.GERMAN_QUIZ_PREMIUM_SCREENSHOTS
  async function capture(name) {
    if (!screenshotFolder) return
    await mkdir(screenshotFolder, { recursive: true })
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: join(screenshotFolder, name + '.png'), animations: 'disabled', scale: 'css' })
  }
  const settings = () => go('settings')
  const numeric = value => Number(value.trim().replace(/[٬,]/gu, '').replace(/[٠-٩]/gu, c => c.charCodeAt(0) - 1632))
  const available = async () => numeric(await page.getByTestId('eligible-count').textContent())
  const noOverflow = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  const input = () => page.locator('#education-file')
  const toSettings = async () => {
    await settings()
    await page.getByRole('heading', { name: educationSection }).waitFor()
  }
  const counts = [personal.entries.length, pack.chapters.length, pack.questions.length].map(value => locale.format(value))
  const checkCounts = async (tab = page) => {
    await tab.locator('.education-counts').waitFor()
    assert.deepEqual(await tab.locator('.education-counts dd').allTextContents(), counts)
  }
  const readEducation = () => page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('german-quiz-study', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction('study', 'readonly')
        const store = transaction.objectStore('study')
        const lookup = store.get('education')
        const keys = store.getAllKeys()
        transaction.oncomplete = () => resolve({ record: lookup.result ?? null, keys: keys.result })
        transaction.onabort = () => reject(transaction.error)
      })
    } finally {
      database.close()
    }
  })
  const disruptNextWrite = mode => page.evaluate(mode => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'study' && key === 'education') {
        IDBObjectStore.prototype.put = original
        if (mode === 'quota') throw new DOMException('Testing quota rollback', 'QuotaExceededError')
        const request = original.call(this, value, key)
        this.transaction.abort()
        return request
      }
      return original.call(this, value, key)
    }
  }, mode)
  const selectFile = (buffer, name = educationFilename) => input().setInputFiles({ name, mimeType: 'application/json', buffer })
  const openChapters = async () => {
    const list = page.locator('.chapter-picker')
    if (await list.getAttribute('open') === null) await list.locator('summary').click()
  }
  const radio = name => page.getByRole('radio', { name, exact: true })
  const checkbox = name => page.getByRole('checkbox', { name, exact: true })
  const chooseChapters = async (level, chapters) => {
    await radio(level).check()
    await openChapters()
    if (await button('مسح التحديد').isEnabled()) await button('مسح التحديد').click()
    for (const id of chapters) await checkbox('الفصل ' + id).check()
  }
  const chooseKinds = async kinds => {
    const detail = page.locator('.activity-picker')
    if (await detail.getAttribute('open') === null) await detail.locator('summary').click()
    const mixed = checkbox('تدريب مختلط')
    if (await mixed.isChecked()) await mixed.uncheck()
    const selected = page.locator('.activity-grid input:checked').first()
    while (await selected.count()) await selected.uncheck()
    for (const kind of kinds) await checkbox(kind).check()
  }
  const selectAdvanced = async (label, value) => {
    const details = page.locator('.advanced-options')
    if (await details.getAttribute('open') === null) await details.locator('summary').click()
    await page.getByLabel(label).selectOption(value)
  }
  const correctStatus = () => page.getByRole('status').filter({ hasText: 'إجابة صحيحة' }).waitFor()
  const incorrectStatus = () => page.getByRole('status').filter({ hasText: 'إجابة غير صحيحة' }).waitFor()
  const start = () => button('ابدأ التدريب').click()
  const next = () => button('النشاط التالي').click()

  await page.goto(appUrl)
  await page.getByRole('heading', { name: 'تقدّمك في الألمانية' }).waitFor()
  await page.locator('.skip-link').focus()
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'انتقل إلى المحتوى')
  await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'H1')
  await page.getByRole('link', { name: 'استيراد المحتوى' }).click()
  await page.getByRole('heading', { name: educationSection }).waitFor()
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  await context.setOffline(true)
  assert.equal(await page.getByRole('button', { name: 'استيراد ملف المحتوى', exact: true }).count(), 1)
  await selectFile(Buffer.from('{'), 'broken.json')
  await page.getByRole('alert').filter({ hasText: 'بنية JSON غير صالحة' }).waitFor()
  assert.equal((await readEducation()).record, null)
  await disruptNextWrite('abort')
  // Delay the local file read so the visible progress stage can be asserted reliably.
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer
    File.prototype.arrayBuffer = async function () {
      await new Promise(resolve => setTimeout(resolve, 400))
      return read.call(this)
    }
  })
  await selectFile(importBuffer)
  await page.getByRole('progressbar', { name: 'تقدّم الاستيراد' }).waitFor()
  await page.getByRole('alert').filter({ hasText: 'تعذّر حفظ الملف في المتصفح' }).waitFor()
  assert.equal((await readEducation()).record, null)
  const chooser = page.waitForEvent('filechooser')
  await button('استيراد ملف المحتوى').click()
  await (await chooser).setFiles(packageFile)
  await shown(importDone)
  await checkCounts()
  const initial = await readEducation()
  assert(isDeepStrictEqual(initial.record.content, fullPackage), 'Both stored payloads must match the imported file')
  assert.deepEqual(initial.keys, ['education'])
  await context.setOffline(false)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await go('')
  await page.getByRole('heading', { name: 'تقدّمك في الألمانية' }).waitFor()
  await capture('01-dashboard')
  await home()
  await page.getByTestId('eligible-count').waitFor()
  await radio('A1+').check()
  const reviewed = await available()
  const hasAutomatic = personal.entries.some(item => item.vocabularyStatus === 'automatically_validated')
  if (hasAutomatic) {
    await settings()
    await radio('المراجَعة والمتحقّق منها آليًا').check()
    await home()
    await page.getByTestId('eligible-count').waitFor()
    assert((await available()) > reviewed)
  }
  await radio('A1+ & A2+').check()
  await radio('٥٠').check()
  await toSettings()
  await selectFile(Buffer.from('[]'), 'wrong-format.json')
  await page.getByRole('alert').filter({ hasText: 'إصداره غير مدعوم' }).waitFor()
  await selectFile(Buffer.from(JSON.stringify({ ...fullPackage, study: {} })), 'broken-study.json')
  await page.getByRole('alert').filter({ hasText: 'بيانات الفصول أو الدروس أو الأنشطة غير صالحة' }).waitFor()
  await selectFile(Buffer.from(JSON.stringify({ ...fullPackage, vocabulary: {} })), 'broken-vocabulary.json')
  await page.getByRole('alert').filter({ hasText: 'إصداره غير مدعوم' }).waitFor()
  for (const failure of ['quota', 'abort']) {
    await disruptNextWrite(failure)
    await selectFile(Buffer.from(JSON.stringify({ ...fullPackage, testMarker: failure })))
    await page.getByRole('alert').filter({
      hasText: failure === 'quota' ? 'مساحة التخزين في المتصفح غير كافية' : 'تعذّر حفظ الملف في المتصفح',
    }).waitFor()
    await page.reload()
    await toSettings()
    await checkCounts()
    assert(isDeepStrictEqual((await readEducation()).record, initial.record), 'Failed writes must preserve the entire current package')
  }
  await disruptNextWrite('abort')
  await selectFile(importBuffer)
  await shown('ملف المحتوى محفوظ بالفعل.')
  assert(isDeepStrictEqual(await readEducation(), initial), 'Identical reimports must leave only one unchanged record')

  await page.getByText('النسخ الاحتياطي والاستعادة', { exact: true }).click()
  const downloadStarted = page.waitForEvent('download')
  await button('تنزيل ملف المحتوى').click()
  const download = await downloadStarted
  assert.equal(download.suggestedFilename(), educationFilename)
  const exported = await readFile(await download.path())
  assert(isDeepStrictEqual(JSON.parse(exported), fullPackage), 'The educational backup must match the imported content')
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
  await button('تثبيت تحديث التطبيق').waitFor()
  const reloaded = page.waitForEvent('load')
  await button('تثبيت تحديث التطبيق').click()
  await reloaded
  await context.setOffline(true)
  await page.reload()
  await toSettings()
  await checkCounts()
  await home()
  await page.getByTestId('eligible-count').waitFor()
  assert(await radio('٥٠').isChecked())
  await capture('02-practice')
  await chooseKinds(['المفردات'])
  const vocabularyRoundLength = Math.min(50, await available())
  await start()
  assert.equal(await page.locator('.session-examples:visible').count(), 0)
  assert((await page.locator('.session-meter').innerText()).includes(locale.format(vocabularyRoundLength)))
  await capture('03-vocabulary')
  let expectedExample = false
  for (let attempt = 0; attempt < 18 && !expectedExample; attempt++) {
    await button('كتابة الإجابة').click()
    await page.getByLabel('إجابتك').fill('Probe – falsche Antwort')
    await button('تحقق من الإجابة').click()
    await incorrectStatus()
    expectedExample = await page.locator('.session-examples p[lang=de][dir=ltr]').count() > 0 &&
      await page.locator('.session-examples p[lang=ar][dir=rtl]').count() > 0
    if (!expectedExample) await next()
  }
  assert(expectedExample)
  await noOverflow()
  await button('إيقاف مؤقت').click()
  await page.getByRole('dialog').waitFor()
  await page.keyboard.press('Escape')
  assert(!await page.getByRole('dialog').isVisible())
  await button('إيقاف مؤقت').click()
  await button('العودة إلى التدريب').click()
  await page.getByRole('link', { name: 'تابع التدريب' }).click()
  await page.locator('.study-feedback:visible').waitFor()
  await page.reload()
  await page.locator('.study-feedback:visible').waitFor()
  assert(await page.locator('.session-examples p[lang=de][dir=ltr]').count())
  await go('vocabulary')
  await page.getByRole('searchbox').waitFor()
  await page.getByRole('searchbox').fill(personal.entries[0].german)
  await page.locator('.example-feedback p[lang=de][dir=ltr]').first().waitFor()


  {
    const names = {
      cloze: 'إكمال الجمل', flashcard: 'البطاقات', verb: 'تصريف الأفعال', grammar: 'القواعد', reading: 'القراءة',
      order: 'ترتيب الجمل', case: 'الحالات الإعرابية', error: 'تصحيح الأخطاء', transform: 'تحويل الجمل',
    }
    for (const [type, name] of Object.entries(names)) {
      const exercise = pack.questions.find(item => item.type === type &&
        (type !== 'reading' || item.answers.length > 1) &&
        pack.questions.filter(other => other.type === type && other.topic === item.topic && other.chapter === item.chapter).length === 1)
      assert(exercise, 'No independent real fixture for ' + type)
      await home()
      await page.getByTestId('eligible-count').waitFor()
      await chooseChapters(exercise.chapter.slice(0, 2) + '+', [exercise.chapter])
      await selectAdvanced('موضوع القواعد', exercise.topic)
      await chooseKinds([name])
      assert.equal(await available(), 1)
      await start()
      if (type === 'verb') await capture('04-conjugation')
      if (type === 'order') await capture('05-ordering')
      if (type === 'reading') await capture('06-reading')
      if (type === 'flashcard') {
        await button('اقلب البطاقة').click()
        await button('أعرفها').click()
        await page.getByRole('status').filter({ hasText: 'بطاقة معروفة' }).waitFor()
      } else {
        if (type === 'order') {
          const tiles = page.locator('[aria-label="المجموعات المتاحة"] button')
          await tiles.first().dragTo(page.locator('.sentence-target'))
          await button('إعادة ترتيب الكلمات').click()
          assert.equal(await page.locator('.sentence-target button').count(), 0)
          for (const token of exercise.tokens) await page.locator('[aria-label="المجموعات المتاحة"]')
            .getByRole('button', { name: token, exact: true }).first().click()
          await button('تحقق من الإجابة').click()
        } else if (type === 'error' && exercise.errorIndex !== undefined) {
          const token = exercise.prompt.slice(exercise.errorIndex).split(/\s/u)[0]
          await page.getByRole('button', { name: token, exact: true }).first().click()
          await button(exercise.answers[0]).click()
        } else if (type === 'reading' || type === 'cloze') {
          await button('كتابة الإجابة').click()
          await page.getByLabel('إجابتك').fill(exercise.answers[type === 'reading' ? 1 : 0])
          await button('تحقق من الإجابة').click()
        } else await button(exercise.answers[0]).click()
        await correctStatus()
        assert.equal(await page.locator('.study-feedback .arabic-explanation').count(), 0)
      }
      await next()
      await page.getByRole('heading', { name: 'انتهى التدريب' }).waitFor()
      await noOverflow()
    }

    await home()
    await chooseChapters('A1+', ['A1:1'])
    await chooseKinds(['المطابقة'])
    await start()
    await page.locator('.matching-board').waitFor()
    await capture('12-matching')
    const getPlan = () => page.evaluate(() => new Promise((resolve, reject) => {
      const opening = indexedDB.open('german-quiz-study', 1)
      opening.onerror = () => reject(opening.error)
      opening.onsuccess = () => {
        const db = opening.result
        const read = db.transaction('study', 'readonly').objectStore('study').get('practice-plan-v2')
        read.onsuccess = () => { db.close(); resolve(read.result?.items[0]?.pairs) }
        read.onerror = () => { db.close(); reject(read.error) }
      }
    }))
    const pairs = await getPlan()
    assert(pairs?.length >= 2)
    for (const pair of pairs) {
      await page.getByRole('group', { name: 'الكلمات الألمانية' }).getByRole('button', { name: pair.german, exact: true }).press('Enter')
      await page.getByRole('group', { name: 'المعاني العربية' }).getByRole('button', { name: pair.arabic, exact: true }).click()
    }
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (value, key) {
        const request = put.call(this, value, key)
        if (key === 'practice-position-v2' && value.results?.length) {
          IDBObjectStore.prototype.put = put
          this.transaction.abort()
        }
        return request
      }
    })
    await button('تحقق من الإجابة').click()
    await correctStatus()
    const failure = page.getByRole('alert').filter({ hasText: 'تعذّر حفظ النتيجة' })
    await failure.waitFor()
    await next()
    await failure.waitFor({ state: 'hidden' })

    await home()
    await chooseChapters('A1+ & A2+', ['A1:1', 'A1:3', 'A2:5'])
    await chooseKinds(['القراءة', 'ترتيب الجمل'])
    assert.equal(await checkbox('الكتابة').count(), 0)
    await radio('كل المتاح').check()
    assert.equal(await available(), 6)
    await page.reload()
    await openChapters()
    assert(await checkbox('الفصل A1:3').isChecked())
    assert(await checkbox('الفصل A2:5').isChecked())
    assert(!(await checkbox('الفصل A1:2').isChecked()))
    assert.equal(await available(), 6)
    await radio('A2+').check()
    assert.equal(await available(), 2)
    await radio('A1+').check()
    assert.equal(await available(), 4)
    await radio('A1+ & A2+').check()
    assert.equal(await available(), 6)
    await start()
    const unique = new Set()
    const sessionChapters = new Set()
    const sessionKinds = new Set()
    for (let i = 0; i < 6; i++) {
      await shown('النشاط ' + locale.format(i + 1) + ' من ' + locale.format(6))
      const chapter = await page.locator('.chapter-context').innerText()
      const kind = await page.locator('.session-context .section-label').innerText()
      const prompt = await page.locator('.study-prompt').count() ? await page.locator('.study-prompt').innerText() : kind
      unique.add([chapter, kind, prompt].join('|'))
      sessionChapters.add(chapter)
      sessionKinds.add(kind)
      await button('كتابة الإجابة').click()
      await page.getByLabel('إجابتك').fill('wrong')
      await button('تحقق من الإجابة').click()
      await incorrectStatus()
      await page.locator('.arabic-explanation').waitFor()
      await next()
    }
    assert.equal(unique.size, 6)
    assert.equal(sessionChapters.size, 3)
    assert.equal(sessionKinds.size, 2)
    await page.getByRole('heading', { name: 'انتهى التدريب' }).waitFor()
    await button('أعد تدريب الأخطاء').click()
    await shown('النشاط ١ من ٦')
    assert.equal(await page.getByLabel('اكتب بالألمانية').count(), 0)

    for (const id of ['A1:1', 'A2:8']) {
      const chapter = pack.chapters.find(chapter => chapter.id === id)
      await go('chapters')
      await page.locator('.chapter-navigation').getByRole('button', { name: new RegExp(escapeRegExp(chapter.title), 'u') }).first().click()
      await page.getByRole('heading', { name: chapter.title, exact: true }).waitFor()
      await button('اختر الفصل للتدريب').click()
      await openChapters()
      assert(await checkbox('الفصل ' + id).isChecked())
      assert.equal(await page.locator('.chapter-picker input:checked').count(), 1)
    }

    await go('chapters')
    await button('تقييم الفصل').click()
    await page.locator('.chapter-context:visible').filter({ hasText: 'A2+' }).waitFor()
    await go('mistakes')
    await page.getByRole('heading', { name: 'دفتر الأخطاء', exact: true }).waitFor()
    await capture('07-notebook')
    await page.getByRole('searchbox', { name: 'بحث في الأخطاء' }).fill('wrong')
    await page.locator('.notebook-list li button').first().click()
    await page.locator('.mistake-facts').filter({ hasText: 'wrong' }).waitFor()
    await capture('08-mistake-detail')
    await page.reload()
    await page.getByRole('searchbox', { name: 'بحث في الأخطاء' }).fill('wrong')
    await page.locator('.notebook-list li button').first().click()
    await page.locator('.mistake-facts').filter({ hasText: 'wrong' }).waitFor()
    await go('progress')
    await page.getByRole('heading', { name: 'تحليلات التقدّم' }).waitFor()
    await page.getByLabel('المقياس').selectOption('answers')
    const chart = page.locator('.chart-column').first()
    await chart.focus()
    await page.keyboard.press('Enter')
    assert.equal(await chart.getAttribute('aria-pressed'), 'true')
    const workload = page.getByRole('group', { name: 'أفق المراجعة' })
    await workload.getByRole('button', { name: '٣٠ يومًا', exact: true }).click()
    await shown('قادمة خلال ٣٠ يومًا')
    await capture('09-analytics')
    await page.setViewportSize({ width: 390, height: 840 })
    await noOverflow()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.locator('.related-mistakes').first().click()
    await page.getByRole('heading', { name: 'دفتر الأخطاء', exact: true }).waitFor()
    assert(page.url().includes('#/mistakes?'))
    assert(await page.locator('.notebook-list li button').count())
    await settings()
    await button('داكن').click()
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')
    await page.getByLabel('المحاولات اليومية').selectOption('10')
    await capture('10-settings-dark')
    await page.setViewportSize({ width: 390, height: 840 })
    await noOverflow()
    await capture('11-settings-mobile')
    await page.reload()
    await page.getByLabel('المحاولات اليومية').waitFor()
    assert.equal(await page.getByLabel('المحاولات اليومية').inputValue(), '10')
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')
    await shown('النسخ الاحتياطي والاستعادة')
    await page.getByText('النسخ الاحتياطي والاستعادة', { exact: true }).click()
    const saveProgress = page.waitForEvent('download')
    await button('تنزيل التقدم').click()
    const progressArchive = await readFile(await (await saveProgress).path())
    const history = JSON.parse(progressArchive)
    assert(history.events.length >= 17)
    assert(!history.events.some(event => event.type === 'writing'))
    assert(history.events.some(event => event.answer === 'wrong' && event.evidenceVersion === 2))
    assert(history.events.some(event => event.chapter === 'A2:5' && event.result === 'incorrect'))
    await page.locator('#study-progress-file').setInputFiles({ name: 'progress.json', mimeType: 'application/json', buffer: progressArchive })
    await shown('تم دمج سجلات التقدم المحفوظة.')
    console.log('Specialized activities, mixed chapters, dashboard, analytics, notebook, and progress backup passed.')
  }

  const profileRoot = tmpdir()
  const profile = await mkdtemp(join(profileRoot, 'german-quiz-education-'))
  try {
    await withProfile(profile, async (persistent, tab) => {
      await tab.goto(appUrl + '#/settings')
      await tab.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
      await persistent.setOffline(true)
      await tab.locator('#education-file').setInputFiles({ name: educationFilename, mimeType: 'application/json', buffer: exported })
      await tab.getByText(importDone, { exact: true }).waitFor()
      await checkCounts(tab)
    })
    await withProfile(profile, async (persistent, tab) => {
      await persistent.setOffline(true)
      await tab.goto(appUrl + '#/settings')
      await checkCounts(tab)
      await tab.getByRole('link', { name: 'التدريب', exact: true }).click()
      await tab.getByRole('button', { name: 'ابدأ التدريب', exact: true }).click()
      await tab.locator('.session-meter').waitFor()
    })
  } finally {
    assert.equal(dirname(profile), profileRoot, 'Only delete the newly created test profile')
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
  assert.deepEqual(unexpectedRequests, [])
  assert.deepEqual(pageErrors, [])
  const shellPaths = new Set([base, ...filePaths.map(file => base + file)])
  assert(serverRequests.every(({ method, url }) => method === 'GET' && shellPaths.has(url)))
  console.log('Unified import passed: progress stages, malformed data, quota, interrupted transactions, duplicate import, export, offline browser restart, and service-worker update.')
} finally {
  await browser?.close()
  server.close()
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
