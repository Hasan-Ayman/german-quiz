import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validatePersonalDataset } from '../src/personal-data'
import { preparePersonalQuiz } from '../src/personal-quiz'
import { eligiblePractice, fromStudyQuestion, loadPracticePreferences, practiceChapters, practiceRound,
  questionGroups, selectedChapters, setChapters, type Candidate } from '../src/practice'
import { flashcardCandidates, vocabularyCandidates } from '../src/practice-vocabulary'
import { validateStudyPack, type StudyQuestion } from '../src/study-content'
import { checkStudyAnswer } from '../src/study-engine'
import type { ChapterKey } from '../src/source-data'
import { fixtureDataset } from './fixtures'

const original = loadPracticePreferences(null, null)
const ids = ['A1:1', 'A1:3', 'A1:7', 'A2:2', 'A2:5'] as const
const chapters = ids.map(id => ({ id, level: id.split(':')[0] as 'A1' | 'A2', number: Number(id.split(':')[1]) }))
const query = (candidate: Candidate[], keys: readonly ChapterKey[], prefs = original) =>
  eligiblePractice(candidate, keys, prefs, new Set(), new Map())
function seeded(seed: number) {
  return () => (seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 2 ** 32
}

it('selects one, nonconsecutive chapters, both levels, all, and none without confusing chapter IDs', () => {
  expect(selectedChapters(chapters, original)).toEqual(ids)
  let prefs = setChapters({ ...original, scope: 'A1' }, ['A1:1'])
  expect(selectedChapters(chapters, prefs)).toEqual(['A1:1'])
  prefs = setChapters(prefs, ['A1:1', 'A1:7'])
  expect(selectedChapters(chapters, prefs)).toEqual(['A1:1', 'A1:7'])
  expect(selectedChapters(chapters, { ...prefs, scope: 'A2' })).toEqual(['A2:2', 'A2:5'])
  expect(selectedChapters(chapters, { ...prefs, scope: 'all' })).toEqual(['A1:1', 'A1:7', 'A2:2', 'A2:5'])
  expect(selectedChapters(chapters, setChapters(prefs, []))).toEqual([])
  prefs = setChapters({ ...prefs, scope: 'all' }, ['A1:3', 'A2:5'])
  expect(selectedChapters(chapters, loadPracticePreferences(JSON.stringify(prefs), null))).toEqual(['A1:3', 'A2:5'])
})

it('migrates the previous cumulative level, count, reliability, and explicit chapter and mode filters', () => {
  const old = JSON.stringify({ level: 'A2', count: 50, reliability: 'with-automatic',
    chapters: ['A2:2'], types: ['noun-plural'] })
  const preferences = loadPracticePreferences(null, old)
  expect(preferences).toMatchObject({ scope: 'all', count: 50, reliability: 'with-automatic', variants: ['noun-plural'] })
  expect(selectedChapters(chapters, preferences)).toEqual(['A2:2'])
  expect(loadPracticePreferences('{', old)).toEqual(preferences)
})

const item = (id: string, type: StudyQuestion['type'], chapter: ChapterKey, prompt: string): StudyQuestion => ({
  id, type, chapter, prompt, answers: ['richtig'], instruction: 'اختر الإجابة', topic: '', german: 'Beispiel',
  arabic: 'مثال', explanation: '', source: { document: chapter.startsWith('A1') ? 'a1-book' : 'a2-book', page: 25 },
  origin: 'authored', verification: 'editorial_checked',
})

it('reports the exact count, removes equivalent items across chapters and mixes tasks and references', () => {
  const pool = [
    item('a', 'cloze', 'A1:1', 'eins'), item('b', 'reading', 'A1:3', 'zwei'),
    item('c', 'cloze', 'A2:5', 'eins'), item('d', 'case', 'A2:5', 'drei'), item('archived', 'writing', 'A2:5', 'vier'),
    ...Array.from({ length: 57 }, (_, i) => item('extra-' + i, 'reading', 'A1:7', 'Text ' + i)),
  ].map(fromStudyQuestion)
  expect(query(pool, [], original)).toEqual([])
  const groups = questionGroups(query(pool, ids))
  expect(groups.size).toBe(60)
  for (const count of [10, 20, 30, 50, 'all'] as const) {
    const round = practiceRound(groups, count, seeded(7))
    expect(round).toHaveLength(count === 'all' ? 60 : count)
    expect(new Set(round.map(candidate => candidate.key)).size).toBe(round.length)
    expect(new Set(round.map(candidate => candidate.activity))).toEqual(new Set(['cloze', 'case', 'reading']))
    expect(round.find(candidate => candidate.id === 'd')?.make().source.document).toBe('a2-book')
  }
  expect(practiceRound(questionGroups(query(pool, ['A2:5'])), 50)).toHaveLength(2)
})

it('uses the version 1 vocabulary independently of the study pack', async () => {
  const bank = await preparePersonalQuiz(fixtureDataset)
  const scope = { ...original, scope: 'A2' as const }
  const v1Chapters = practiceChapters(bank, null)
  const filtered = query(vocabularyCandidates(bank, 'all', true), selectedChapters(v1Chapters, scope), scope)
  expect(filtered.length).toBeGreaterThan(0)
  expect(filtered.every(candidate => candidate.chapter.startsWith('A2:'))).toBe(true)
  expect(practiceRound(questionGroups(filtered), 'all').every(candidate => {
    const question = candidate.make()
    return question?.choices?.filter(choice => checkStudyAnswer(question, choice)).length === 1
  })).toBe(true)
})

const vocabularyFile = process.env.GERMAN_QUIZ_V2_TEST_FILE
const studyFolder = process.env.GERMAN_QUIZ_STUDY_AUDIT

describe.runIf(Boolean(vocabularyFile && studyFolder))('complete private datasets', () => {
  it('checks 500 seeded A1, strict A2 and combined mixed rounds against eligible content', async () => {
    const bank = await preparePersonalQuiz(validatePersonalDataset(JSON.parse(readFileSync(vocabularyFile!, 'utf8'))))
    const pack = validateStudyPack(JSON.parse(readFileSync(join(studyFolder!, 'german-quiz-study-private.json'), 'utf8')))
    const allChapters = practiceChapters(bank, pack)
    expect(allChapters).toHaveLength(24)
    const checkedKinds = new Set<string>()
    const study = pack.questions.map(fromStudyQuestion)
    const checkedFacts = new Set<string>()
    for (const scope of ['A1', 'A2', 'all'] as const) {
      for (const expanded of [false, true]) {
        const prefs = { ...original, scope }
        const available = selectedChapters(allChapters, prefs)
        const vocabulary = vocabularyCandidates(bank, scope, expanded)
        const pool = [...study, ...vocabulary, ...flashcardCandidates(bank, allChapters, 'de-ar', expanded)]
        const groups = questionGroups(query(pool, available, prefs))
        for (let seed = 0; seed < 84; seed++) {
          const count = ([10, 20, 30, 50] as const)[seed % 4]
          const round = practiceRound(groups, count, seeded(seed + 13))
          expect(round).toHaveLength(count)
          expect(new Set(round.map(candidate => candidate.key)).size).toBe(round.length)
          for (const candidate of round) {
            expect(available).toContain(candidate.chapter)
            checkedKinds.add(candidate.activity)
            if (checkedFacts.has(candidate.id)) continue
            checkedFacts.add(candidate.id)
            const question = candidate.make()
            expect(question.chapter).toBe(candidate.chapter)
            expect(question.source.document.startsWith(candidate.chapter.slice(0, 2).toLowerCase())).toBe(true)
            expect(question.source.page).toBeGreaterThan(0)
            if (question.choices) expect(question.choices.filter(choice => checkStudyAnswer(question, choice))).toHaveLength(1)
          }
        }
      }
    }
    expect(checkedKinds.size).toBe(11)
    expect(checkedKinds.has('writing')).toBe(false)
  }, 35_000)
})
