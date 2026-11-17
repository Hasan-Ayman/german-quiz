import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const folder = process.env.GERMAN_QUIZ_STUDY_AUDIT
describe.runIf(Boolean(folder))('editorially checked private practice material', () => {
  it('ties bilingual material for all chapters to a valid source and a supported answer', () => {
    const pack = JSON.parse(readFileSync(join(folder, 'german-quiz-study-private.json'), 'utf8'))
    expect(new Set(pack.questions.map(item => item.id)).size).toBe(pack.questions.length)
    expect(new Set(pack.lessons.map(item => item.chapter)).size).toBe(24)
    expect(pack.lessons.map(item => item.topic).sort()).toEqual(pack.chapters.flatMap(chapter =>
      chapter.grammar.map((_, index) => chapter.id + ':' + index)).sort())
    expect(pack.questions.filter(item => item.type === 'reading')).toHaveLength(24)
    expect(pack.questions.filter(item => item.type === 'writing')).toHaveLength(24)
    const offered = new Set(pack.questions.map(item => item.type))
    expect(offered.size).toBe(10)
    for (const item of pack.questions) {
      const chapter = pack.chapters.find(value => value.id === item.chapter)
      const lesson = pack.lessons.find(value => value.topic === item.topic)
      expect(lesson.chapter).toBe(chapter.id)
      expect(item.source).toEqual({ document: chapter.source, page: chapter.overviewPage })
      expect(item.origin).toBe('authored')
      expect(item.verification).toBe('editorial_checked')
      expect(item.arabic).toMatch(/\p{Script=Arabic}/u)
      if (item.choices) expect(item.choices.filter(choice => item.answers.includes(choice))).toHaveLength(1)
      if (item.tokens) expect(item.answers).toContain(item.tokens.join(' '))
    }
  })
  it('audits German words against the private four-source corpus', () => {
    const read = name => JSON.parse(readFileSync(join(folder, name), 'utf8'))
    const inventory = read('page-inventory-private.json')
    const pack = read('german-quiz-study-private.json')
    const review = read('authored-lexical-review-private.json')
    const words = text => text.normalize('NFC').toLocaleLowerCase('de').match(/\p{Script=Latin}+/gu) ?? []
    const sourceWords = new Set(Object.values(inventory).flatMap(pages => pages.flatMap(page => words(page.text))))
    const correct = pack.questions.flatMap(item => [item.german, item.type === 'writing' ? item.model :
      item.type === 'reading' || item.type === 'transform' ? item.prompt : ''])
    const vocabulary = new Set(correct.flatMap(words))
    expect(vocabulary.size).toBe(review.total)
    expect([...vocabulary].filter(word => !sourceWords.has(word)).sort()).toEqual(review.derived.map(row => row.form).sort())
    expect(review.derived.every(row => inventory[row.source.document][row.source.page - 1].hasText)).toBe(true)
  })

})
