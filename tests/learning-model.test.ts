import { expect, it } from 'vitest'
import { adaptiveRound, buildEvidence, difficultyByActivity, masterySummary, reviewOrder } from '../src/learning-model'
import { visibleMistakes } from '../src/MistakeNotebook'
import { day, encodeProgress, mergeStudyProgress, readProgressFile, type StudyEvent } from '../src/study-progress'
import { fromStudyQuestion, questionGroups } from '../src/practice'
import type { StudyQuestion } from '../src/study-content'
import { playableSession } from '../src/practice-session'
import { checkStudyAnswer } from '../src/study-engine'

const time = Date.now() - 30 * day
const event = (id: string, elapsed: number, result: StudyEvent['result'], index: number): StudyEvent => ({
  id: id + ':' + index, questionId: id, time: time + elapsed * day, result, evidenceVersion: 2,
  chapter: 'A1:1', type: 'grammar', topic: 'A1:1:0',
})
const make = (id: string, type: StudyQuestion['type'] = 'grammar'): StudyQuestion => ({
  id, chapter: 'A1:1', type, prompt: 'Testfrage', instruction: 'اختبار', topic: 'A1:1:0', answers: ['Grüße'],
  source: { document: 'a1-book', page: 7 }, explanation: '', german: 'Testsatz.', arabic: 'اختبار',
  origin: 'authored', verification: 'editorial_checked',
})

it('requires spaced successes and reopens a resolved mistake without erasing history', () => {
  const rows = [event('x', 0, 'incorrect', 0), event('x', .1, 'incorrect', 1),
    event('x', .5, 'correct', 2), event('x', .6, 'correct', 3), event('x', 1.5, 'correct', 4),
    event('x', 4.5, 'correct', 5), event('x', 11.5, 'correct', 6)]
  const state = (count: number) => buildEvidence(rows.slice(0, count)).get('x')!
  expect(state(1).due).toBe(time + day / 4)
  expect(state(2)).toMatchObject({ errors: 2, spacedSuccesses: 0, stage: 'review' })
  expect(state(4)).toMatchObject({ errors: 2, reviews: 1, spacedSuccesses: 1, stage: 'improving', resolved: false })
  expect(state(6)).toMatchObject({ stage: 'strong', resolved: false })
  expect(state(7)).toMatchObject({ stage: 'mastered', resolved: true, reviews: 4 })
  const seenAgain = buildEvidence([...rows, event('x', 17, 'incorrect', 7)]).get('x')!
  expect(seenAgain).toMatchObject({ errors: 3, reviews: 4, stage: 'review', resolved: false })
  expect(seenAgain.history).toHaveLength(8)
  expect(visibleMistakes([state(7)], 'resolved', time + 20 * day)).toHaveLength(1)
  expect(visibleMistakes([seenAgain], 'repeated', time + 20 * day)).toHaveLength(1)
  expect(visibleMistakes([seenAgain], 'improving', time + 20 * day)).toHaveLength(0)
  expect(visibleMistakes([seenAgain], 'due', time + 20 * day)).toHaveLength(1)
})

it('uses timestamps that actually exist and withholds a mastery percentage for limited evidence', () => {
  const { evidenceVersion: _, ...legacy } = event('old', 0, 'incorrect', 1)
  const archive = event('essay', 0, 'completed', 0)
  const profile = buildEvidence([legacy, { ...archive, type: 'writing' }])
  expect(profile.size).toBe(1)
  expect(profile.get('old')?.lastMistake?.answer).toBeUndefined()
  expect(profile.get('old')?.due).toBe(legacy.time)
  expect(masterySummary(profile.values()).value).toBeNull()
  expect(masterySummary(buildEvidence([]).values()).value).toBeNull()
  const histories = ['a', 'b', 'c'].flatMap(id => [0, 1, 4, 11].map((step, i) => event(id, step, 'correct', i)))
  expect(masterySummary(buildEvidence(histories).values())).toEqual({ value: 1, mastered: 3, touched: 3 })
})

it('balances overdue, unseen and weak candidates deterministically without crossing scope', () => {
  const now = time + 5 * day
  const due = Array.from({ length: 8 }, (_, i) => make('due' + i))
  const weak = Array.from({ length: 8 }, (_, i) => make('weak' + i))
  const fresh = Array.from({ length: 8 }, (_, i) => make('new' + i))
  const learned = buildEvidence([...due.map((q, i) => event(q.id, 1, 'incorrect', i)),
    ...weak.map((q, i) => event(q.id, 4.5, 'correct', i))])
  const groups = questionGroups([...due, ...weak, ...fresh].map(fromStudyQuestion).map(q => ({ ...q, key: q.id })))
  const round = adaptiveRound(groups, 10, learned, now, 73)
  const ids = (value: typeof round) => value.map(item => item.id)
  expect(ids(round)).toEqual(ids(adaptiveRound(groups, 10, learned, now, 73)))
  expect(round.filter(q => q.id.startsWith('due'))).toHaveLength(4)
  expect(round.filter(q => q.id.startsWith('new'))).toHaveLength(4)
  expect(round.filter(q => q.id.startsWith('weak'))).toHaveLength(2)
  expect(new Set(ids(round)).size).toBe(10)
  expect(round.every(q => q.chapter === 'A1:1')).toBe(true)
  expect(adaptiveRound(groups, 'all', learned, now, 73)).toHaveLength(24)
  expect(reviewOrder([...learned.values()], now)[0].id).toMatch(/^due/u)
})

it('increases recall support only after consistent success across days within a skill', () => {
  const winning = Array.from({ length: 8 }, (_, i) => event('win', i, 'correct', i))
  expect(difficultyByActivity(winning.slice(0, 4)).get('grammar')).toBe('standard')
  expect(difficultyByActivity(winning).get('grammar')).toBe('recall')
  expect(difficultyByActivity(winning.map(item => ({ ...item, time }))).get('grammar')).toBe('standard')
  const losing = Array.from({ length: 12 }, (_, i) => event('win', i + 8, 'incorrect', i + 8))
  expect(difficultyByActivity([...winning, ...losing]).get('grammar')).toBe('guided')
})

it('preserves a mixed legacy plan and checkpoints without presenting writing', () => {
  const old = { id: 'session', items: [make('one'), make('essay', 'writing'), make('two')] }
  const originalPosition = { index: 1, response: 'Original writing draft', results: ['correct' as const] }
  const visible = playableSession(old, originalPosition)!
  expect(visible.plan.items.map(item => item.id)).toEqual(['one', 'two'])
  expect(visible.position).toEqual({ index: 1, results: ['correct'], response: '' })
  expect(originalPosition.response).toBe('Original writing draft')
  expect(old.items.map(item => item.type)).toContain('writing')
  expect(playableSession({ ...old, items: [old.items[1]] }, originalPosition)).toBeNull()
})

it('preserves old and v2 backups with new original answers and rejects conflicts', async () => {
  const { evidenceVersion: _, ...past } = event('past', 1, 'incorrect', 1)
  const newAnswer = { ...event('new', 5, 'incorrect', 1), answer: 'Grusse', activity: 'grammar' as const }
  const oldArchive = { format: 'german-quiz-study-progress', version: 1, events: [past] }
  const restored = await readProgressFile(new File([JSON.stringify(oldArchive)], 'old.json'))
  expect(restored).toEqual([past])
  const current = await readProgressFile(new File([encodeProgress([...restored, newAnswer])], 'new.json'))
  expect(mergeStudyProgress(current, current)).toEqual(current)
  expect(current.find(item => item.id === newAnswer.id)?.answer).toBe('Grusse')
  expect(() => mergeStudyProgress(current, [{ ...newAnswer, answer: 'different' }])).toThrow(/Conflicting/u)
})

it('retains German distinctions in short typed responses', () => {
  const question = make('word')
  expect(checkStudyAnswer(question, ' Grüße. ')).toBe(true)
  for (const wrong of ['Grusse', 'GrüSe', 'grüße', 'keine Grüße']) expect(checkStudyAnswer(question, wrong)).toBe(false)
})

it('indexes a long study history by stable item ID', () => {
  const events = Array.from({ length: 20_000 }, (_, index) =>
    event('item-' + (index % 1000), Math.floor(index / 1000), index % 5 ? 'correct' : 'incorrect', index))
  const evidence = buildEvidence(events)
  expect(evidence.size).toBe(1000)
  expect(evidence.get('item-0')?.errors).toBe(20)
  expect([...evidence.values()].reduce((count, item) => count + item.history.length, 0)).toBe(events.length)
})

it.runIf(Boolean(process.env.GERMAN_QUIZ_EDUCATION_TEST_FILE))('generates unambiguous matched pairs with unchanged source references', async () => {
  const { readFile } = await import('node:fs/promises')
  const { validateEducationPackage } = await import('../src/education-package')
  const { preparePersonalQuiz } = await import('../src/personal-quiz')
  const { matchingCandidates } = await import('../src/matching')
  const { germanKey, arabicKey } = await import('../src/quiz')
  const content = validateEducationPackage(JSON.parse(await readFile(process.env.GERMAN_QUIZ_EDUCATION_TEST_FILE!, 'utf8')))
  const bank = await preparePersonalQuiz(content.vocabulary)
  const candidates = matchingCandidates(bank, 'all', true)
  expect(candidates.length).toBeGreaterThan(10)
  expect(new Set(candidates.map(item => item.id)).size).toBe(candidates.length)
  for (const item of candidates) {
    const puzzle = item.make()
    const pairs = puzzle.pairs!
    expect(new Set(pairs.map(pair => germanKey(pair.german))).size).toBe(pairs.length)
    expect(new Set(pairs.map(pair => arabicKey(pair.arabic))).size).toBe(pairs.length)
    for (const pair of pairs) {
      expect(content.vocabulary.entries.some(entry => entry.german === pair.german &&
        entry.sources.some(source => source.level + ':' + source.chapter === puzzle.chapter && source.page === pair.source.page))).toBe(true)
    }
  }
  const reviewed = matchingCandidates(bank, 'all', false)
  expect(reviewed.every(item => item.make().verification === 'reviewed')).toBe(true)
}, 15_000)
