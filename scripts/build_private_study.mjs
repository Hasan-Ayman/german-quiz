import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const folder = resolve(process.argv[2] ?? '.')
const checkout = fileURLToPath(new URL('../', import.meta.url))
const location = relative(checkout, folder)
if (!location || (!location.startsWith('..') && !isAbsolute(location))) {
  throw new Error('Use a private directory outside the checkout.')
}
const read = async name => JSON.parse(await readFile(resolve(folder, name), 'utf8'))
const curriculum = await read('curriculum-private.json')
const rows = [...await read('reviewed-a1-material.json'), ...await read('reviewed-a2-material.json')]
const variants = await read('reviewed-variants.json')
const writingModels = await read('reviewed-writing-models.json')
const chapters = curriculum.chapters
const questions = []
const lessons = []
const lexical = text => text.normalize('NFC').toLocaleLowerCase('de').replace(/\s+/gu, ' ').trim()
const unique = values => new Set(values.map(lexical)).size === values.length

assert.equal(chapters.length, 24)
assert.equal(rows.length, chapters.length)
assert.equal(new Set(rows.map(row => row[0])).size, chapters.length)
for (const [chapter, topicIndex, kind, title, explanation, before, answer, after, wrong,
  translation, second, secondArabic, readingPrompt, readingAnswer, readingWrong, writing] of rows) {
  const record = chapters.find(item => item.id === chapter)
  assert(record?.grammar[topicIndex], 'Missing curriculum topic for ' + chapter)
  const topic = chapter + ':' + topicIndex
  const source = { document: record.source, page: record.overviewPage }
  const target = before + answer + after
  const correctReading = [readingAnswer, ...readingWrong]
  assert(unique([answer, ...wrong]) && unique(correctReading), 'Repeated choice for ' + chapter)
  assert([title, explanation, translation, secondArabic, readingPrompt, readingAnswer, writing]
    .every(value => /\p{Script=Arabic}/u.test(value)), 'Missing Arabic text for ' + chapter)
  assert([target, second].every(value => /\p{Script=Latin}/u.test(value)), 'Missing German text for ' + chapter)
  lessons.push({ topic, chapter, title, explanation, german: target, arabic: translation, source,
    origin: 'authored', verification: 'editorial_checked' })
  const add = (type, question) => questions.push({
    id: chapter + ':' + type, type, chapter, topic, source, origin: 'authored',
    verification: 'editorial_checked', explanation, german: target, arabic: translation, ...question,
  })
  add('cloze', { prompt: before + '____' + after, instruction: title, answers: [answer], choices: [answer, ...wrong] })
  add(kind, { prompt: before + '____' + after, instruction: title, answers: [answer], choices: [answer, ...wrong] })
  add('flashcard', { prompt: target, instruction: 'استحضر المعنى بالعربية ثم اقلب البطاقة.', answers: [translation] })
  add('error', { prompt: before + wrong[0] + after, instruction: 'صحّح الجزء الخاطئ. ' + title,
    answers: [target, answer], choices: [target, ...wrong.map(option => before + option + after)], errorIndex: before.length })
  const passage = target + ' ' + second
  add('reading', { prompt: passage, instruction: readingPrompt, answers: [readingAnswer], choices: correctReading,
    passageArabic: translation + ' ' + secondArabic,
    explanation: secondArabic, german: second, arabic: secondArabic })
  const [model, modelArabic] = writingModels[chapter] ?? []
  assert(/\p{Script=Latin}/u.test(model) && /\p{Script=Arabic}/u.test(modelArabic), 'Missing reviewed writing model for ' + chapter)
  add('writing', { prompt: '', instruction: writing, answers: [], model, passageArabic: modelArabic })
  const related = variants[chapter]
  if (related?.order) {
    assert(unique(related.order))
    assert.equal(related.order.join(' '), target, 'Word-order model does not match its reviewed sentence for ' + chapter)
    add('order', { prompt: '', instruction: 'رتّب المجموعات بدءًا بـ «' + related.order[0] + '».',
      answers: [target], tokens: related.order })
  }
  if (related?.transform) {
    const [prompt, instruction, answers] = related.transform
    assert(unique(answers) && answers.includes(target))
    add('transform', { prompt, instruction, answers, choices: [target, ...wrong.map(option => before + option + after)] })
  }
}
for (const [chapter, topicIndex, type, title, explanation, before, answer, after, wrong, arabic] of await read('reviewed-supplementary-material.json')) {
  const record = chapters.find(item => item.id === chapter)
  assert(record?.grammar[topicIndex] && ['grammar', 'verb', 'case'].includes(type))
  const topic = chapter + ':' + topicIndex
  assert(!lessons.some(item => item.topic === topic), 'Duplicate grammar topic')
  assert(unique([answer, ...wrong]))
  assert([title, explanation, arabic].every(value => /\p{Script=Arabic}/u.test(value)))
  const german = before + answer + after
  const material = { topic, chapter, explanation, german, arabic,
    source: { document: record.source, page: record.overviewPage }, origin: 'authored', verification: 'editorial_checked' }
  lessons.push({ ...material, title })
  questions.push({ ...material, id: topic + ':practice', type, prompt: before + '____' + after,
    instruction: title, answers: [answer], choices: [answer, ...wrong] })
}
const sources = curriculum.sources.map(({ id, pages, sha256 }) => ({ id, pages, sha256 }))
const data = { format: 'german-quiz-study', version: 1, sources, chapters, lessons, questions }
const filename = resolve(folder, 'german-quiz-study-private.json')
await writeFile(filename, JSON.stringify(data, null, 2) + '\n')
console.log(JSON.stringify({ chapters: chapters.length, lessons: lessons.length, questions: questions.length,
  scored: questions.filter(item => item.type !== 'writing' && item.type !== 'flashcard').length,
  byType: questions.reduce((counts, item) => ({ ...counts, [item.type]: (counts[item.type] ?? 0) + 1 }), {}) }))
