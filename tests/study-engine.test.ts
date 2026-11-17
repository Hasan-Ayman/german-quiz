import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeStudyAnswer, validateStudyPack } from '../src/study-content'
import { checkStudyAnswer, studyPool, studyRound } from '../src/study-engine'

it('keeps German inflection and capitalization and accepts harmless Arabic diacritic variants', () => {
  expect(normalizeStudyAnswer('  das  Ziel. ')).toBe('das Ziel')
  expect(normalizeStudyAnswer('das ziel.')).toBe('das ziel')
  expect(normalizeStudyAnswer('أَدَاة؟', 'ar')).toBe('اداة')
})

it('rejects incompatible study imports before persistence', () => {
  expect(() => validateStudyPack({ format: 'german-quiz-personal', version: 2 })).toThrow(/Unsupported/)
})

const folder = process.env.GERMAN_QUIZ_STUDY_AUDIT

describe.runIf(Boolean(folder))('validates the actual private package', () => {
  it('keeps all records and supports every chapter and skill filter', () => {
    const book = JSON.parse(readFileSync(join(folder!, 'german-quiz-study-private.json'), 'utf8'))
    const pack = validateStudyPack(book)
    expect(pack).toEqual(book)
    const a2 = studyPool(pack, { level: 'A2', type: 'all', chapters: [] })
    expect(a2.every(question => question.chapter.startsWith('A2:'))).toBe(true)
    for (const chapter of pack.chapters) {
      const questions = studyPool(pack, { level: 'all', type: 'all', chapters: [chapter.id] })
      expect(questions.map(item => item.type)).toEqual(expect.arrayContaining(['cloze', 'reading', 'writing', 'flashcard']))
      for (const question of questions.filter(item => item.answers.length)) {
        expect(checkStudyAnswer(question, question.answers[0])).toBe(true)
        expect(checkStudyAnswer(question, '')).toBe(false)
      }
    }
    const choices = a2.find(item => item.choices)!
    expect(() => validateStudyPack({ ...book, questions: [{ ...choices, choices: [choices.answers[0], choices.answers[0]] }] })).toThrow(/choices/)
    const round = studyRound(a2, 10, () => 0.25)
    expect(round).toHaveLength(10)
    expect(new Set(round.map(item => item.chapter + ':' + item.german)).size).toBe(10)
  })
})
