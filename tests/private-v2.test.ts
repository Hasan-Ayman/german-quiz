import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validatePersonalDataset } from '../src/personal-data'
import { factType, preparePersonalQuiz, selectedPersonalCatalog } from '../src/personal-quiz'
import { answer, germanKey, makeQuiz, newAttempt, nextQuestion, restoreQuestion, retryQuiz } from '../src/quiz'
import { grammarModes, selectableTypes } from '../src/question-types'
import { fixtureDataset } from './fixtures'

it('continues to accept the v1 file format and rejects a v2 file without its source inventory', () => {
  expect(validatePersonalDataset(fixtureDataset).version).toBe(1)
  expect(() => validatePersonalDataset({ ...fixtureDataset, version: 2 })).toThrow(/inventory/)
})

const privatePath = process.env.GERMAN_QUIZ_V2_TEST_FILE

describe.runIf(Boolean(privatePath))('full private v2 dataset', () => {
  const input = privatePath ? JSON.parse(readFileSync(privatePath, 'utf8')) : null

  it.runIf(Boolean(privatePath))('preserves every printed row and withholds rows that require review', () => {
    const parsed = validatePersonalDataset(input)
    expect(parsed.version).toBe(2)
    expect(parsed.sourceRows).toHaveLength(1575)
    expect(new Set(parsed.sourceRows!.map(row => row.id)).size).toBe(1575)
    const reviewRows = new Set(parsed.sourceRows!.filter(row => row.verification_status === 'needs_manual_review')
      .map(row => row.id))
    expect(reviewRows.size).toBeGreaterThan(0)
    expect(parsed.entries.every(entry => entry.sources.every(source => !reviewRows.has(source.id)))).toBe(true)
    expect(() => validatePersonalDataset({ ...input, sourceRows: [...input.sourceRows, input.sourceRows[0]] }))
      .toThrow(/source row/)
    expect(() => validatePersonalDataset({ ...input, entries: [{ ...input.entries[0], german: 'Testwort' }, ...input.entries.slice(1)] }))
      .toThrow(/entry/)
  })

  it('preserves source sentences and links each bilingual example to its validation evidence', () => {
    const parsed = validatePersonalDataset(input)
    const archived = parsed.sourceRows!.flatMap(row => row.examples ?? [])
    const originals = archived.filter(example => example.source_type === 'source_pdf')
    const generated = archived.filter(example => example.source_type === 'generated')
    expect(originals).toHaveLength(888)
    expect(generated.length).toBeGreaterThan(600)
    expect(archived.every(example => example.arabic && example.example_review?.evidence)).toBe(true)
    expect(generated.every(example => example.source_page === null)).toBe(true)
    expect(parsed.entries.every(entry => !entry.incompleteExampleLevels.length)).toBe(true)
    expect(validatePersonalDataset(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed)
    const altered = structuredClone(input)
    const original = altered.sourceRows.find((row: { example_sentence: string | null }) => row.example_sentence)
    original.examples[0].german += ' X'
    expect(() => validatePersonalDataset(altered)).toThrow(/archive/)
  })

  it.runIf(Boolean(privatePath))('generates and restores each independently selectable question type', async () => {
    const dataset = validatePersonalDataset(input)
    const bank = await preparePersonalQuiz(dataset)
    const checkedSentences = new Set(dataset.sourceRows!.flatMap(row => (row.examples ?? [])
      .filter(example => example.example_review && example.verification_status !== 'needs_review')
      .map(example => example.german)))
    const base = { level: 'A2', count: 10, reliability: 'with-automatic' } as const
    const full = selectedPersonalCatalog(bank, base)
    expect(new Set([...full.facts.values()].map(factType))).toEqual(new Set(selectableTypes))
    for (const type of selectableTypes) {
      const catalog = selectedPersonalCatalog(bank, { ...base, types: [type] })
      const questions = makeQuiz(catalog, () => .41, 10)
      expect(questions.length, type).toBeGreaterThan(0)
      expect(new Set(questions.map(question => question.entry.german)).size).toBe(questions.length)
      for (const question of questions) {
        expect(question.choices.filter(choice => choice.id === question.correctId)).toHaveLength(1)
        expect(new Set(question.choices.map(choice => choice.text)).size).toBe(question.choices.length)
        expect(question.choices.length).toBeGreaterThanOrEqual(2)
        expect(restoreQuestion(full, question.id, question.choices.map(choice => choice.id))).toEqual(question)
        if (type.endsWith('-context')) {
          const sample = question.entry.examples.find(example => example.german === question.exampleGerman)
          expect(sample).toMatchObject({ arabic: expect.any(String), example_review: { evidence: expect.any(String) } })
          expect(question.prompt).toEqual({ lang: 'ar', text: sample?.arabic })
          expect(question.choices).toHaveLength(4)
          expect(question.choices.every(choice => choice.lang === 'de' && checkedSentences.has(choice.text))).toBe(true)
          expect(question.hint?.lang).toBe('ar')
        }
      }
      const wrong = questions[0].choices.find(choice => choice.id !== questions[0].correctId)!
      const answered = nextQuestion(answer(newAttempt(questions, 'random'), wrong.id))
      expect(retryQuiz(answered, () => .41)[0].id).toBe(questions[0].id)
    }
  }, 20_000)

  it.runIf(Boolean(privatePath))('filters chapters, preserves cumulative levels and gracefully skips unsupported facts', async () => {
    const bank = await preparePersonalQuiz(validatePersonalDataset(input))
    const base = { level: 'A2', count: 10, reliability: 'with-automatic' } as const
    const full = selectedPersonalCatalog(bank, base)
    const a1 = selectedPersonalCatalog(bank, { ...base, level: 'A1' })
    expect([...a1.facts.values()].every(fact => fact.entry.levels.includes('A1'))).toBe(true)
    expect([...full.facts.values()].some(fact => fact.entry.levels.join() === 'A2')).toBe(true)
    const scoped = selectedPersonalCatalog(bank, { ...base, types: ['noun-plural', 'verb-perfect'], chapters: ['A2:1'] })
    expect(scoped.facts.size).toBeGreaterThan(0)
    expect(new Set([...scoped.facts.values()].map(fact => fact.mode))).toEqual(new Set(['noun-plural', 'verb-perfect']))
    expect([...scoped.facts.values()].every(fact => fact.chapters?.includes('A2:1'))).toBe(true)
    expect(makeQuiz(selectedPersonalCatalog(bank, { ...base, types: [] }))).toEqual([])
    expect(grammarModes.every(mode => [...full.facts.values()].some(fact => fact.mode === mode))).toBe(true)
    expect(bank.chapters).toHaveLength(24)
  }, 20_000)

  it('keeps choices unique and examples in scope in 528 seeded rounds', async () => {
    const bank = await preparePersonalQuiz(validatePersonalDataset(input))
    for (const level of ['A1', 'A2'] as const) {
      for (const reliability of ['reviewed', 'with-automatic'] as const) {
        for (const count of [10, 20, 30, 50] as const) {
          const catalog = selectedPersonalCatalog(bank, { level, count, reliability })
          for (let seed = 1; seed <= 33; seed++) {
            let state = seed
            const questions = makeQuiz(catalog, () => {
              state = (Math.imul(state, 1664525) + 1013904223) >>> 0
              return state / 2 ** 32
            }, count)
            const allowedCount = Math.min(count, catalog.entryCount)
            if (questions.length !== allowedCount ||
                new Set(questions.map(question => germanKey(question.entry.german))).size !== questions.length) {
              throw new Error(`Invalid round size or duplicate headword (${level}, ${reliability}, ${count}, seed ${seed})`)
            }
            for (const question of questions) {
              const choices = question.choices
              if (choices.filter(choice => choice.id === question.correctId).length !== 1 ||
                  new Set(choices.map(choice => choice.text)).size !== choices.length ||
                  (level === 'A1' && !question.entry.levels.includes('A1')) ||
                  (question.exampleGerman && !question.entry.examples.some(example =>
                    example.german === question.exampleGerman && example.arabic === question.prompt.text &&
                    (level === 'A2' || example.level === 'A1')))) {
                throw new Error(`Invalid option or example provenance (${level}, ${reliability}, seed ${seed}, ${question.id})`)
              }
            }
          }
        }
      }
    }
  }, 20_000)
})
