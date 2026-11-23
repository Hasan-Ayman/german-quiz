import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { chromium } from 'playwright-core'
import { preparePersonalQuiz } from '../src/personal-quiz.ts'
import { vocabularyCandidates } from '../src/practice-vocabulary.ts'
import { germanKey } from '../src/quiz.ts'

const [previousFile, expandedFile, reportFile] = process.argv.slice(2)
const old = JSON.parse(await readFile(previousFile, 'utf8'))
const expanded = JSON.parse(await readFile(expandedFile, 'utf8'))
const recoveryOnly=process.env.GERMAN_QUIZ_BROWSER_FOCUS==='answer_recovery'
const correctionOnly=process.env.GERMAN_QUIZ_BROWSER_FOCUS==='reading_corrections'
const teacherOnly=process.env.GERMAN_QUIZ_BROWSER_FOCUS==='teacher_integration'
if(teacherOnly){assert(isDeepStrictEqual(old.vocabulary,expanded.vocabulary));assert(isDeepStrictEqual(old.study,expanded.study))}
const dist = new URL('../dist/', import.meta.url)
const names = [...(await readdir(dist)).filter(name => name !== 'assets'),
  ...(await readdir(new URL('assets/', dist))).map(name => 'assets/' + name)]
const files = new Map(await Promise.all(names.map(async name => [name, await readFile(new URL(name, dist))])))
const types = { js: 'application/javascript', css: 'text/css', html: 'text/html', png: 'image/png',
  svg: 'image/svg+xml', webmanifest: 'application/manifest+json' }
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  const filename = path === '/german-quiz/' ? 'index.html' : path.slice('/german-quiz/'.length)
  const data = files.get(filename)
  if (req.method !== 'GET' || !path.startsWith('/german-quiz/') || !data) return res.writeHead(404).end()
  res.writeHead(200, { 'Content-Type': types[filename.split('.').at(-1)] }).end(data)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch({ channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  const url = 'http://127.0.0.1:' + server.address().port + '/german-quiz/'
  const foreign = []
  await context.route('**/*', route => {
    const req = route.request()
    if (req.method() === 'GET' && req.url().startsWith(url)) return route.continue()
    foreign.push(req.method())
    return route.abort()
  })
  const page = await context.newPage()
  // Each chapter starts a replacement session in this disposable test profile.
  page.on('dialog', dialog => dialog.accept())
  const go = name => page.evaluate(name => { location.hash = '/' + name }, name)
  const button = name => page.getByRole('button', { name, exact: true })
  const readRecord = key => page.evaluate(key => new Promise((resolve, reject) => {
    const open = indexedDB.open('german-quiz-study', 1)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const read = db.transaction('study', 'readonly').objectStore('study').get(key)
      read.onsuccess = () => { db.close(); resolve(read.result) }
      read.onerror = () => { db.close(); reject(read.error) }
    }
  }), key)
  await page.goto(url + '#/settings')
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  await context.setOffline(true)
  await page.locator('#education-file').setInputFiles(previousFile)
  await page.getByText('تم استيراد المحتوى التعليمي وحفظه على هذا الجهاز.', { exact: true }).waitFor()
  const previousQuestion = old.study.questions.find(item => item.type === 'cloze')
  const event = { id: 'preservation-review-1', questionId: previousQuestion.id, type: previousQuestion.type,
    chapter: previousQuestion.chapter, topic: previousQuestion.topic, time: Date.now() - 86400000,
    result: 'incorrect', evidenceVersion: 2, answer: 'preserved-test-response' }
  await page.getByText('النسخ الاحتياطي والاستعادة', { exact: true }).click()
  await page.locator('#study-progress-file').setInputFiles({ name: 'history.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'german-quiz-study-progress', version: 2, events: [event] })) })
  await page.getByText('تم دمج سجلات التقدم المحفوظة.', { exact: true }).waitFor()
  const history = await readRecord('progress')
  await page.locator('#education-file').setInputFiles(expandedFile)
  await page.getByText('تم استيراد المحتوى التعليمي وحفظه على هذا الجهاز.', { exact: true }).waitFor()
  const contentDownload = page.waitForEvent('download')
  await button('تنزيل ملف المحتوى').click()
  assert(isDeepStrictEqual(JSON.parse(await readFile(await (await contentDownload).path(), 'utf8')), expanded))
  await page.waitForFunction(count => document.querySelectorAll('.education-counts dd')[2]?.textContent === count,
    new Intl.NumberFormat('ar-u-nu-arab').format(expanded.study.questions.length))
  assert(isDeepStrictEqual(await readRecord('progress'), history))
  assert(isDeepStrictEqual((await readRecord('education')).content, expanded))
  await page.reload()
  await page.locator('.education-counts').waitFor()
  assert(isDeepStrictEqual(await readRecord('progress'), history))
  if (expanded.study.sourceActivities?.length&&!recoveryOnly&&!correctionOnly&&!teacherOnly) {
    const chapterIds = [...new Set(expanded.study.lessons.filter(item => item.origin === 'source_derived').map(item => item.chapter))]
    for (const chapterId of chapterIds) {
      await go('chapters')
      const chapter = expanded.study.chapters.find(item => item.id === chapterId)
      await page.locator('.chapter-navigation').getByRole('button').filter({ hasText: chapter.title }).click()
      const sourceLessons = expanded.study.lessons.filter(item => item.origin === 'source_derived' && item.chapter === chapterId)
      for (const lesson of sourceLessons) {
      await page.locator('details').filter({has:page.getByText(lesson.explanation,{exact:true})}).locator('summary').click()
      await page.getByText(lesson.explanation, { exact: true }).waitFor({ state: 'visible' })
      }
    const targetLesson = sourceLessons.find(lesson => expanded.study.questions.some(q => q.topic === lesson.topic && q.sourceActivityRef))
    assert(targetLesson)
    await page.locator('details').filter({has:page.getByText(targetLesson.explanation,{exact:true})}).getByRole('button', { name: 'تدرّب على هذه القاعدة', exact: true }).click()
    await button('ابدأ التدريب').click()
    await page.getByRole('progressbar', { name: 'تقدم الجلسة', exact: true }).waitFor()
    const generated = await readRecord('practice-plan-v2')
    assert(generated.items.length > 0 && generated.items.every(q => q.chapter === chapterId && q.topic === targetLesson.topic && q.sourceActivityRef))
    const first=generated.items[0]
    if(first.type==='order'){
      for(const token of first.tokens)await page.locator('[aria-label="المجموعات المتاحة"]').getByRole('button',{name:token,exact:true}).first().click()
    }else if(first.type==='flashcard'){
      await button('اقلب البطاقة').click();await button('أعرفها').click()
    }else{
      if(first.type==='error'&&first.errorIndex!==undefined){
        const word=[...first.prompt.matchAll(/\S+/gu)].find(w=>w.index===first.errorIndex)
        await page.locator('.study-word-bank').getByRole('button',{name:word[0],exact:true}).click()
      }
      if (!await page.getByLabel('إجابتك', { exact: true }).isVisible()) await button('كتابة الإجابة').click()
      await page.getByLabel('إجابتك', { exact: true }).fill(first.answers[0])
    }
    if(first.type!=='flashcard')await button('تحقق من الإجابة').click()
    await page.getByRole('status').filter({ hasText:first.type==='flashcard'?'بطاقة معروفة':'إجابة صحيحة' }).waitFor()
    console.log('Normal source practice passed: ' + chapterId)
    }
  }
  await go('mistakes')
  await page.getByRole('searchbox', { name: 'بحث في الأخطاء' }).fill('preserved-test-response')
  await page.locator('.notebook-list li button').first().click()
  await page.locator('.mistake-facts').filter({ hasText: 'preserved-test-response' }).waitFor()

  const newQuestions = expanded.study.questions.filter(item => item.origin === 'source_derived')
  const sample = [newQuestions.find(q => q.sourceEvidence?.field === 'plural'),
    newQuestions.find(q => q.sourceEvidence?.field === 'perfect'),
    ...expanded.study.readingPassages.map(p => newQuestions.find(q => q.passageRef === p.id)),
    ...[...new Set(expanded.study.sourceActivities.map(item => item.chapter))].flatMap(chapter =>
      ['verb','cloze','order','grammar','flashcard','transform','error','case'].map(type => newQuestions.find(q => q.chapter === chapter && q.sourceActivityRef && q.type === type)).filter(Boolean))]
  const supplemental=[...(expanded.contentEngineering?.reviewSupplement?.examples??[]),
    ...(expanded.contentEngineering?.exampleBatches??[]).flatMap(batch=>batch.examples??[])]
  const bank=await preparePersonalQuiz(expanded.vocabulary)
  const candidates=vocabularyCandidates(bank,'all',true)
  const examples=supplemental.map(addition=>{
    const entry=expanded.vocabulary.entries.find(e=>e.id===addition.entryId)
    const candidate=candidates.find(c=>c.key==='word:'+germanKey(entry.german)&&c.variant==='article')??
      candidates.find(c=>c.key==='word:'+germanKey(entry.german))
    assert(candidate,'An example target must remain eligible')
    return candidate.make()
  })
  sample.push(...examples)
  if(examples.length){
    sample.push({...examples[0],id:'example-wrong-answer'})
    sample.push({...examples[0],id:'example-unapproved',examples:examples[0].examples.map(ex=>({...ex,verification_status:'needs_review'}))})
    sample.push({...examples[0],id:'example-missing',examples:[]})
  }
  if(recoveryOnly){
    const ids=new Set(expanded.contentEngineering.answerRecovery.additions.map(item=>item.id))
    sample.splice(0,sample.length,...newQuestions.filter(q=>ids.has(q.id)))
    assert.equal(sample.length,12)
  }
  if(correctionOnly){
    const ids=new Set(expanded.contentEngineering.sourceTextCorrections.passages.flatMap(item=>item.questionIds))
    sample.splice(0,sample.length,...newQuestions.filter(q=>ids.has(q.id)))
    assert(sample.length>0)
    assert(sample.every(q=>!q.prompt.includes('1 Verkäuferin:')))
  }
  if(teacherOnly){
    const smoke=[...sample.slice(0,2),...['verb','cloze','order','grammar','flashcard','transform','error','case','reading'].map(type=>newQuestions.find(q=>q.sourceActivityRef&&q.type===type)||newQuestions.find(q=>q.type===type)),examples[0],...sample.slice(-3)].filter(Boolean)
    sample.splice(0,sample.length,...new Map(smoke.map(q=>[q.id,q])).values())
  }
  for (const [index, question] of sample.entries()) {
    await page.setViewportSize({ width: index % 2 ? 390 : 1200, height: 844 })
    assert(question)
    await page.evaluate(async ({ question, index }) => {
      const db = await new Promise(resolve => { const r = indexedDB.open('german-quiz-study', 1); r.onsuccess = () => resolve(r.result) })
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction('study', 'readwrite')
          const store = tx.objectStore('study')
          const id = 'source-browser-' + index
          store.put({ id, items: [question] }, 'practice-plan-v2')
          store.put({ id, index: 0, results: [], response: '' }, 'practice-position-v2')
          tx.oncomplete = resolve
          tx.onabort = () => reject(tx.error)
        })
      } finally { db.close() }
      location.hash = '/practice'
    }, { question, index })
    await page.reload()
    await page.getByRole('progressbar', { name: 'تقدم الجلسة', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    assert.equal(await page.locator('.session-examples').count(),0)
    if (question.type === 'reading') {
      if(question.transcriptEvidence)await page.getByText('قراءة مبنية على نص الاستماع المكتوب؛ هذا النشاط لا يشغّل تسجيلًا صوتيًا.',{exact:true}).waitFor()
      assert.equal(await page.locator('[lang="de"][dir="ltr"]').count() > 0, true)
      assert.equal(await page.getByText(question.passageArabic, { exact: true }).count(), 0)
      await button('كتابة الإجابة').click()
      await page.getByLabel('إجابتك', { exact: true }).fill(question.answers[0])
    } else if (question.type === 'flashcard') {
      assert.equal(await page.locator('.flip-card-face [lang="de"][dir="ltr"]').count(), 1)
      await button('اقلب البطاقة').click()
      assert.equal(await page.locator('.flip-card-face [lang="ar"][dir="rtl"]').count(), 1)
      await button('أعرفها').click()
    } else if (question.type === 'order') {
      for (const token of question.tokens) await page.locator('[aria-label="المجموعات المتاحة"]').getByRole('button', { name: token, exact: true }).first().click()
    } else {
      if (question.type === 'error' && question.errorIndex !== undefined) {
        const word=[...question.prompt.matchAll(/\S+/gu)].find(word=>word.index===question.errorIndex)
        assert(word)
        await page.locator('.study-word-bank').getByRole('button',{name:word[0],exact:true}).click()
      }
      if (question.choices) await button('كتابة الإجابة').click()
      await page.getByLabel('إجابتك', { exact: true }).fill(question.id==='example-wrong-answer'?'WRONG 999':question.answers[0])
    }
    if (question.type !== 'flashcard') await button('تحقق من الإجابة').click()
    await page.getByRole('status').filter({ hasText: question.type === 'flashcard' ? 'بطاقة معروفة' : question.id==='example-wrong-answer'?'إجابة غير صحيحة':'إجابة صحيحة' }).waitFor()
    if (question.type === 'reading') {
      await page.getByText('ترجمة النص', { exact: true }).click()
      assert.equal(await page.getByText(question.passageArabic, { exact: true }).getAttribute('dir'), 'rtl')
      await page.getByText(question.passageArabic, { exact: true }).waitFor({ state: 'visible' })
      if (process.env.GERMAN_QUIZ_REVIEW_IMAGES) await page.screenshot({ path: join(process.env.GERMAN_QUIZ_REVIEW_IMAGES, 'reading-' + index + '.png'), fullPage: true })
    }
    if(question.examples?.length&&!['example-unapproved'].includes(question.id)){
      const shown=question.examples[0]
      assert.equal(await page.locator('.session-examples p[lang="de"][dir="ltr"]').textContent(),shown.german)
      if(shown.arabic)assert.equal(await page.locator('.session-examples p[lang="ar"][dir="rtl"]').textContent(),shown.arabic)
      if(shown.sourcePdf)assert((await page.locator('.session-examples').textContent()).includes(shown.sourcePdf))
    }else assert.equal(await page.locator('.session-examples').count(),0)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    await button('النشاط التالي').click()
    await page.getByRole('heading', { name: 'انتهى التدريب', exact: true }).waitFor()
  }
  assert(isDeepStrictEqual((await readRecord('progress')).find(item => item.id === event.id), history[0]))
  assert.deepEqual(foreign, [])
  const focused=recoveryOnly||correctionOnly||teacherOnly
  const result={ scope:teacherOnly?'teacher_integration_unchanged_educational_payload':recoveryOnly?'final_import_and_12_recovered_questions':correctionOnly?'final_import_and_corrected_source_passages':'complete_source_regression',exactCompleteImport: true, exactExport: true, offlineReload: true, oldHistoryUnchanged: true,
    oldMistakeAccessible: true, sourceTypedForms:sample.filter(q=>q.sourceEvidence&&['plural','perfect'].includes(q.sourceEvidence.field)).length, bookActivityTypes: [...new Set(sample.filter(q=>q.sourceActivityRef).map(q=>q.type))], sourceLessonsRendered:focused?0:expanded.study.lessons.filter(item=>item.origin==='source_derived').length, normalPracticeLaunch:!focused&&Boolean(expanded.study.sourceActivities?.length), readingPassagesTested:sample.filter(q=>q.type==='reading').length, mobileOverflow: false, readingDirection: 'de:ltr ar:rtl',
    approvedSupplementExamplesRendered:examples.filter(ex=>sample.some(q=>q.id===ex.id)).length, correctAndWrongExampleFeedback:teacherOnly||!focused, unapprovedAndMissingExamplesHidden:teacherOnly||!focused, samples:sample.length, importedVocabulary: expanded.vocabulary.entries.length, importedExercises: expanded.study.questions.length }
  if(reportFile)await writeFile(reportFile,JSON.stringify(result,null,2))
  console.log(JSON.stringify(result))
} finally {
  await browser?.close()
  server.close()
}
