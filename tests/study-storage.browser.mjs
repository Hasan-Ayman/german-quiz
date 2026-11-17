import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import ts from 'typescript'

const source = await readFile(new URL('../src/study-storage.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const url = 'data:text/javascript;base64,' + Buffer.from(outputText).toString('base64')
const browser = await chromium.launch({ channel: 'chrome' })
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.route('https://study-storage.test/', route => route.fulfill({ contentType: 'text/html', body: '<title>Storage test</title>' }))
  await page.goto('https://study-storage.test/')
  const result = await page.evaluate(async url => {
    const { readStudyRecord, updateStudyRecord, saveStudyPack } = await import(url)
    const open = indexedDB.open('german-quiz-personal', 1)
    const personal = await new Promise((resolve, reject) => {
      open.onupgradeneeded = () => open.result.createObjectStore('vocabulary')
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    await new Promise((resolve, reject) => {
      const transaction = personal.transaction('vocabulary', 'readwrite')
      transaction.objectStore('vocabulary').put({ version: 1 }, 'active')
      transaction.oncomplete = resolve
      transaction.onabort = reject
    })
    await saveStudyPack({ format: 'german-quiz-study', version: 1 })
    await Promise.all(Array.from({ length: 5 }, () => updateStudyRecord('counter', value => (value ?? 0) + 1)))
    let aborted = false
    try {
      await updateStudyRecord('pack', () => { throw new Error('rollback') })
    } catch {
      aborted = true
    }
    const legacy = await new Promise((resolve, reject) => {
      const request = personal.transaction('vocabulary').objectStore('vocabulary').get('active')
      request.onsuccess = () => resolve(request.result)
      request.onerror = reject
    })
    personal.close()
    return { aborted, legacy, pack: await readStudyRecord('pack'), counter: await readStudyRecord('counter') }
  }, url)
  assert.deepEqual(result, { aborted: true, legacy: { version: 1 }, pack: { format: 'german-quiz-study', version: 1 }, counter: 5 })
  console.log('Private study IndexedDB isolation, atomic rollback, and concurrent writes passed.')
} finally {
  await browser.close()
}
