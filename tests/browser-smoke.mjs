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
  page.setDefaultTimeout(10_000)
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.name))
  page.on('dialog', dialog => dialog.accept())
  const go = route => page.evaluate(name => { window.location.hash = '/' + name }, route)
  const shown = (text, options = {}) => page.getByText(text, { exact: true, ...options }).waitFor()
  const button = name => page.getByRole('button', { name, exact: true })
  const home = () => go('')
  const settings = () => go('settings')
  const numeric = value => Number(value.trim().replace(/[٬,]/gu, '').replace(/[٠-٩]/gu, c => c.charCodeAt(0) - 1632))
  const available = async () => numeric(await page.getByTestId('eligible-count').textContent())
  const noOverflow = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  const vocabularyInput = () => page.locator('.vocabulary-file input[type=file]').first()
  const toSettings = async () => {
    await settings()
    const importDetails = page.locator('.settings-section').filter({ has: page.getByText('استيراد المحتوى الخاص', { exact: true }) })
    await importDetails.waitFor()
    if (await importDetails.getAttribute('open') === null) await importDetails.locator('summary').click()
  }
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
  await page.getByRole('heading', { name: 'أضف محتوى التعلّم الخاص بك' }).waitFor()
  await page.locator('.skip-link').focus()
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'انتقل إلى المحتوى')
  await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'H1')
  await page.getByRole('link', { name: 'استيراد المحتوى' }).click()
  await page.getByRole('heading', { name: 'ابدأ باستيراد مفرداتك' }).waitFor()
  await vocabularyInput().setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{') })
  await page.getByRole('alert').filter({ hasText: 'بنية JSON غير صالحة' }).waitFor()
  if (legacyFile) {
    await vocabularyInput().setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: legacyFile })
    await page.getByRole('heading', { name: vocabularySection }).waitFor()
  }
  await vocabularyInput().setInputFiles({ name: fixtureName, mimeType: 'application/json', buffer: importBuffer })
  const countText = locale.format(personal.entries.length) + ' مفردة مستوردة'
  await page.getByText(countText, { exact: false }).waitFor()
  if (legacyFile) {
    const backup = await page.evaluate(async () => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('german-quiz-personal')
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
  await vocabularyInput().setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('[]') })
  await page.getByRole('alert').filter({ hasText: 'إصداره غير مدعوم' }).waitFor()
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
    await vocabularyInput().setInputFiles({ name: fixtureName, mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ ...personal, replacementMarker: true })) })
    await page.getByRole('alert').filter({
      hasText: failure === 'quota' ? 'مساحة التخزين في المتصفح غير كافية' : 'تعذّر حفظ الملف في المتصفح',
    }).waitFor()
    await page.reload()
    await toSettings()
    await page.getByText(countText, { exact: false }).waitFor()
  }

  const downloadStarted = page.waitForEvent('download')
  await button('تنزيل ملف المفردات').click()
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
  await button('تثبيت تحديث التطبيق').waitFor()
  const reloaded = page.waitForEvent('load')
  await button('تثبيت تحديث التطبيق').click()
  await reloaded
  await context.setOffline(true)
  await page.reload()
  await toSettings()
  await page.getByText(countText, { exact: false }).waitFor()
  await home()
  await page.getByTestId('eligible-count').waitFor()
  assert(await radio('٥٠').isChecked())
  await chooseKinds(['المفردات'])
  const vocabularyRoundLength = Math.min(50, await available())
  await start()
  assert.equal(await page.locator('.session-examples:visible').count(), 0)
  assert((await page.locator('.session-meter').innerText()).includes(locale.format(vocabularyRoundLength)))
  let expectedExample = false
  for (let attempt = 0; attempt < 18 && !expectedExample; attempt++) {
    await page.locator('.session-choice').first().click()
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

  if (process.env.GERMAN_QUIZ_STUDY_AUDIT) {
    const path = join(process.env.GERMAN_QUIZ_STUDY_AUDIT, 'german-quiz-study-private.json')
    const pack = JSON.parse(await readFile(path, 'utf8'))
    const studyReady = () => page.getByText('محتوى الدراسة جاهز', { exact: false }).waitFor()
    await toSettings()
    await page.locator('#study-import').setInputFiles(path)
    await studyReady()
    await page.reload()
    await toSettings()
    await studyReady()
    await page.locator('#study-import').setInputFiles({ name: 'broken-study.json', mimeType: 'application/json', buffer: Buffer.from('{}') })
    await page.getByRole('alert').filter({ hasText: 'تعذّر استيراد حزمة الدراسة' }).waitFor()
    await studyReady()

    const names = {
      cloze: 'إكمال الجمل', flashcard: 'البطاقات', verb: 'تصريف الأفعال', grammar: 'القواعد', reading: 'القراءة',
      order: 'ترتيب الجمل', case: 'الحالات الإعرابية', error: 'تصحيح الأخطاء', transform: 'تحويل الجمل', writing: 'الكتابة',
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
      if (type === 'flashcard') {
        await button('اقلب البطاقة').click()
        await button('أعرفها').click()
        await page.getByRole('status').filter({ hasText: 'بطاقة معروفة' }).waitFor()
      } else if (type === 'writing') {
        await page.getByLabel('اكتب بالألمانية').fill(exercise.model)
        await button('تمّت المراجعة الذاتية').click()
      } else {
        if (type === 'order') {
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
        assert(await page.locator('.study-feedback p[lang=de][dir=ltr]').count())
        assert(await page.locator('.study-feedback p[lang=ar][dir=rtl]').count())
      }
      await next()
      await page.getByRole('heading', { name: 'انتهى التدريب' }).waitFor()
      await noOverflow()
    }

    await home()
    await chooseChapters('A1+ & A2+', ['A1:1', 'A1:3', 'A2:5'])
    await chooseKinds(['القراءة', 'الكتابة'])
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
      const isWriting = await page.getByLabel('اكتب بالألمانية').isVisible()
      const chapter = await page.locator('.chapter-context').innerText()
      const kind = await page.locator('.session-context .section-label').innerText()
      const prompt = isWriting ? await page.locator('.session-layout h1').innerText() : await page.locator('.study-prompt').innerText()
      unique.add([chapter, kind, prompt].join('|'))
      sessionChapters.add(chapter)
      sessionKinds.add(kind)
      if (isWriting) {
        await page.getByLabel('اكتب بالألمانية').fill('Probe.')
        await button('تمّت المراجعة الذاتية').click()
      } else {
        await button('كتابة الإجابة').click()
        await page.getByLabel('إجابتك').fill('wrong')
        await button('تحقق من الإجابة').click()
        await incorrectStatus()
      }
      await next()
    }
    assert.equal(unique.size, 6)
    assert.equal(sessionChapters.size, 3)
    assert.equal(sessionKinds.size, 2)
    await page.getByRole('heading', { name: 'انتهى التدريب' }).waitFor()
    await button('أعد تدريب الأخطاء').click()
    await shown('النشاط ١ من ٣')
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
    await go('progress')
    await page.getByRole('heading', { name: 'لوحة التقدم' }).waitFor()
    await page.getByRole('heading', { name: 'التقدّم حسب الفصل' }).waitFor()
    await settings()
    await shown('النسخ الاحتياطي والاستعادة')
    await page.getByText('النسخ الاحتياطي والاستعادة', { exact: true }).click()
    const saveProgress = page.waitForEvent('download')
    await button('تنزيل التقدم').click()
    const progressArchive = await readFile(await (await saveProgress).path())
    const history = JSON.parse(progressArchive)
    assert(history.events.length >= 17)
    assert(history.events.some(event => event.type === 'writing' && event.result === 'completed'))
    assert(history.events.some(event => event.chapter === 'A2:5' && event.result === 'incorrect'))
    await page.locator('#study-progress-file').setInputFiles({ name: 'progress.json', mimeType: 'application/json', buffer: progressArchive })
    await shown('تم دمج سجلات التقدم المحفوظة.')
    const studyOnly = await browser.newContext()
    const studyPage = await studyOnly.newPage()
    await studyPage.goto(appUrl + '#/settings')
    await studyPage.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
    await studyOnly.setOffline(true)
    await studyPage.locator('#study-import').setInputFiles(path)
    await studyPage.getByText('محتوى الدراسة جاهز', { exact: false }).waitFor()
    await studyPage.getByRole('link', { name: 'التدريب', exact: true }).click()
    await studyPage.getByRole('button', { name: 'ابدأ التدريب', exact: true }).click()
    await studyPage.locator('.session-meter').waitFor()
    await studyOnly.close()
    console.log('Ten learning activities, three mixed chapters, study-only offline practice, results, retry, lesson navigation and progress backup passed.')
  }

  const fresh = await browser.newContext({ viewport: { width: 1280, height: 850 } })
  const transferPage = await fresh.newPage()
  await transferPage.goto(appUrl + '#/settings')
  await transferPage.getByRole('heading', { name: 'ابدأ باستيراد مفرداتك' }).waitFor()
  await transferPage.locator('.vocabulary-file input[type=file]').first().setInputFiles({ name: fixtureName, mimeType: 'application/json', buffer: exported })
  await transferPage.getByText(countText, { exact: false }).waitFor()
  assert.deepEqual(unexpectedRequests, [])
  assert.deepEqual(pageErrors, [])
  const shellPaths = new Set([base, ...filePaths.map(file => base + file)])
  assert(serverRequests.every(({ method, url }) => method === 'GET' && shellPaths.has(url)))
  console.log('Browser smoke passed: both imports, rollback, export transfer, offline, service-worker update, keyboard, bidirectional text and responsive layout.')
} finally {
  await browser?.close()
  server.close()
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
