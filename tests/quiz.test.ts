import { describe, expect, it } from 'vitest'
import { distractorGroups, entries, rawPilot, revision } from './fixtures'
import { articles, readVerifiedPilot } from '../src/pilot'
import {
  answer, buildCatalog, incorrectAnswers, isCorrect, makeQuiz, modes, newAttempt,
  nextQuestion, questionCounts, restoreQuestion, retryQuiz,
} from '../src/quiz'
import { loadAttempt, loadQuizSettings, saveAttempt } from '../src/storage'

const catalog = buildCatalog(entries, 'A2', false, distractorGroups)
const catalogs = { A1: buildCatalog(entries, 'A1'), A2: catalog }
const entry = (german: string) => entries.find(value => value.german === german)!

function seeded(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

describe('question generation', () => {
  it('restricts A1 facts and distractors to entries with an A1 source in all modes', () => {
    const facts = [...catalogs.A1.facts.values()]
    const a1Ids = new Set(entries.filter(entry => entry.levels.includes('A1')).map(entry => entry.id))
    expect(new Set(facts.map(fact => fact.mode))).toEqual(new Set(modes))
    for (const fact of facts) {
      expect(a1Ids.has(fact.entry.id)).toBe(true)
      if (fact.mode !== 'article') expect(fact.distractors.every(choice => a1Ids.has(choice.id))).toBe(true)
    }
  })

  it('treats A2 as cumulative and includes shared vocabulary once in a round', () => {
    const questions = makeQuiz(catalog, seeded(11), 50)
    expect(questions.some(q => q.entry.levels.join() === 'A1')).toBe(true)
    expect(questions.some(q => q.entry.levels.join() === 'A2')).toBe(true)
    const shared = questions.filter(q => q.entry.levels.length === 2).map(q => q.entry.id)
    expect(shared.length).toBeGreaterThan(0)
    expect(new Set(shared).size).toBe(shared.length)
  })

  it.each(questionCounts)('generates %i different entries when enough are eligible', count => {
    const questions = makeQuiz(catalog, seeded(23), count)
    expect(questions).toHaveLength(count)
    expect(new Set(questions.map(question => question.entry.id)).size).toBe(count)
  })

  it('caps the round at the eligible A1 count and restores settings from storage', () => {
    expect(loadQuizSettings(null, true)).toEqual({ level: 'A2', count: 10, reliability: 'reviewed' })
    expect(loadQuizSettings('{"level":"A3","count":40}')).toEqual({ level: 'A2', count: 10, reliability: 'reviewed' })
    const settings = loadQuizSettings('{"level":"A1","count":50}')
    expect(settings).toEqual({ level: 'A1', count: 50, reliability: 'reviewed' })
    const limited = catalogs[settings.level]
    expect(limited.entryCount).toBeLessThan(settings.count)
    expect(makeQuiz(limited, seeded(1), settings.count)).toHaveLength(limited.entryCount)
  })

  it('mixes the five modes and picks 10 different vocabulary entries', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const quiz = makeQuiz(catalog, seeded(seed))
      expect(quiz).toHaveLength(10)
      expect(new Set(quiz.map(question => question.entry.id)).size).toBe(10)
      expect(new Set(quiz.map(question => question.mode))).toEqual(new Set(modes))
    }
    expect(makeQuiz(catalog, seeded(1)).map(q => q.id))
      .not.toEqual(makeQuiz(catalog, seeded(2)).map(q => q.id))
  })

  it('generates exactly one correct answer and safe distinct options for every pilot fact', () => {
    for (const [id, fact] of catalog.facts) {
      const [question] = makeQuiz({ ...catalog, facts: new Map([[id, fact]]) }, seeded(16))
      const { choices, correctId, mode } = question
      expect(choices.filter(choice => isCorrect(question, choice.id))).toHaveLength(1)
      expect(isCorrect(question, 'unknown-option')).toBe(false)
      expect(new Set(choices.map(choice => choice.text)).size).toBe(choices.length)
      if (mode === 'article') {
        expect(choices).toHaveLength(3)
        expect(new Set(choices.map(choice => choice.text))).toEqual(new Set(articles))
        expect(correctId).toBe(question.entry.article)
      } else {
        expect(choices).toHaveLength(4)
        expect(correctId).toBe(question.entry.id)
        for (const [index, option] of choices.entries()) {
          expect(entries.some(value => value.id === option.id)).toBe(true)
          for (const other of choices.slice(index + 1)) {
            expect(catalog.compatible(option.id, other.id)).toBe(true)
          }
        }
        expect(choices.find(choice => choice.id === correctId)?.text).toBe(mode === 'ar-de'
          ? question.entry.german : question.entry.arabic_translations.join(' / '))
      }
    }
  })

  it('rejects overlapping meanings, equivalent forms, and synonyms as distractors', () => {
    expect(catalog.compatible(entry('Name').id, entry('Vorname').id)).toBe(false)
    expect(catalog.compatible(entry('gern').id, entry('am liebsten').id)).toBe(false)

    const name = entry('Name')
    const stadt = entry('Stadt')
    const overlap = { ...stadt, arabic_translations: ['الاِسم في الاختبار', ...stadt.arabic_translations] }
    const nearGloss = buildCatalog(entries.map(row => row.id === stadt.id ? overlap : row))
    expect(nearGloss.compatible(name.id, stadt.id)).toBe(false)
    expect([...nearGloss.facts.values()].some(fact => fact.entry.id === name.id && fact.mode === 'ar-de')).toBe(false)

    const withSynonym = buildCatalog(entries.map(row => row.id === stadt.id
      ? { ...row, synonyms: [...row.synonyms, ...name.synonyms] }
      : row))
    expect(withSynonym.compatible(name.id, stadt.id)).toBe(false)
  })

  it('skips a question with no safe distractors and returns the actual smaller count', () => {
    const few = buildCatalog([entry('Name'), entry('Vorname'), entry('Stadt')])
    const questions = makeQuiz(few, seeded(10))
    expect(questions).toHaveLength(3)
    expect(questions.every(question => question.mode === 'article')).toBe(true)
    expect(makeQuiz(buildCatalog([entry('wohnen'), entry('heißen')]))).toEqual([])
  })

  it('rejects a pilot with unverified or flagged content at the source', () => {
    const [first] = rawPilot
    expect(readVerifiedPilot([first])[0].id).toBe(first.id)
    expect(() => readVerifiedPilot([{ ...first, verification_status: 'automated_pass' }])).toThrow(/unverified/)
    expect(() => readVerifiedPilot([{ ...first, sources: [
      ...first.sources, { verification_status: 'needs_manual_review' },
    ] }])).toThrow(/unverified/)
    expect(() => readVerifiedPilot([first, first])).toThrow(/invalid/)
  })
})

describe('progress and retries', () => {
  const questions = makeQuiz(catalog, seeded(42))
  const wrong = (index: number) => questions[index].choices.find(choice => !isCorrect(questions[index], choice.id))!.id

  it('locks the selected answer and advances only after an explicit next action', () => {
    const start = newAttempt(questions, 'random')
    expect(nextQuestion(start)).toBe(start)
    expect(answer(start, 'unknown-option')).toBe(start)
    const locked = answer(start, wrong(0))
    expect(locked.index).toBe(0)
    expect(answer(locked, questions[0].correctId)).toBe(locked)
    expect(nextQuestion(locked).index).toBe(1)
  })

  it('retries only mistakes, keeps the same fact and correct answer, and reshuffles', () => {
    let attempt = newAttempt(questions, 'random')
    for (const [index, question] of questions.entries()) {
      attempt = nextQuestion(answer(attempt, index < 2 ? wrong(index) : question.correctId))
    }
    expect(attempt.finished).toBe(true)
    const retry = retryQuiz(attempt, seeded(19))
    expect(new Set(retry.map(question => question.id))).toEqual(new Set(questions.slice(0, 2).map(q => q.id)))
    for (const question of retry) {
      const original = questions.find(value => value.id === question.id)!
      expect(question.correctId).toBe(original.correctId)
      expect(question.prompt).toEqual(original.prompt)
      expect(question.mode).toBe(original.mode)
      expect(new Set(question.choices)).toEqual(new Set(original.choices))
      expect(question.choices.map(choice => choice.id)).not.toEqual(original.choices.map(choice => choice.id))
    }

    let second = newAttempt(retry, 'retry')
    second = nextQuestion(answer(second, retry[0].choices.find(choice => choice.id !== retry[0].correctId)!.id))
    second = nextQuestion(answer(second, retry[1].correctId))
    expect(incorrectAnswers(second)).toHaveLength(1)
    const again = newAttempt(retryQuiz(second), 'retry')
    expect(again.questions).toHaveLength(1)
    expect(retryQuiz(nextQuestion(answer(again, again.questions[0].correctId)))).toEqual([])
  })

  it('restores the active question and choice order and rejects stale or unsafe saved state', () => {
    const attempt = answer(newAttempt(questions, 'random'), wrong(0))
    const saved = saveAttempt(attempt, revision)
    expect(loadAttempt(saved, catalogs, revision)).toEqual(attempt)
    expect(loadAttempt(saved, catalogs, 'other-pilot')).toBeNull()
    const corrupted = JSON.parse(saved)
    corrupted.questions[0].options[0] = 'unknown-option'
    expect(loadAttempt(JSON.stringify(corrupted), catalogs, revision)).toBeNull()
    const ids = questions[0].choices.map(choice => choice.id)
    ids[1] = ids[0]
    expect(restoreQuestion(catalog, questions[0].id, ids)).toBeUndefined()
  })

  it('restores a long A1 round and retries its original fact after changing the setup', () => {
    const a1 = makeQuiz(catalogs.A1, seeded(4), 20)
    let attempt = newAttempt(a1, 'random', 'A1', 20)
    for (const [index, question] of a1.entries()) {
      const choice = index === 0 ? question.choices.find(c => c.id !== question.correctId)!.id : question.correctId
      attempt = nextQuestion(answer(attempt, choice))
    }
    expect(loadQuizSettings('{"level":"A2","count":10}')).toEqual({ level: 'A2', count: 10, reliability: 'reviewed' })
    const restored = loadAttempt(saveAttempt(attempt, revision), catalogs, revision)!
    expect(restored).toEqual(attempt)
    expect(restored.questions).toHaveLength(20)
    const [question] = retryQuiz(restored, seeded(2))
    expect(question).toMatchObject({ id: a1[0].id, mode: a1[0].mode, prompt: a1[0].prompt, correctId: a1[0].correctId })
  })

  it('restores a Phase 2 round saved before level and count were added', () => {
    const attempt = newAttempt(questions, 'random')
    const legacy = JSON.parse(saveAttempt(attempt, revision))
    delete legacy.level
    delete legacy.requestedCount
    expect(loadAttempt(JSON.stringify(legacy), catalogs, revision)).toEqual(attempt)
  })
})
