import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { preparePersonalQuiz } from '../src/personal-quiz'
import { validatePersonalDataset } from '../src/personal-data'
import { validateStudyPack } from '../src/study-content'
import { checkStudyAnswer, studyAssessment, studyPool } from '../src/study-engine'
import { studyVocabularyQuestions } from '../src/study-vocabulary'
import { flashcardModes, vocabularyFlashcards } from '../src/study-flashcards'

const privateFile = process.env.GERMAN_QUIZ_V2_TEST_FILE
const curriculum = process.env.GERMAN_QUIZ_STUDY_AUDIT
describe.runIf(Boolean(privateFile && curriculum))('study integration with real vocabulary', () => {
  it('gives all chapters assessed vocabulary, preserved source refs, and semantically distinct options', async () => {
    const personal = validatePersonalDataset(JSON.parse(readFileSync(privateFile!, 'utf8')))
    const pack = validateStudyPack(JSON.parse(readFileSync(join(curriculum!, 'german-quiz-study-private.json'), 'utf8')))
    const bank = await preparePersonalQuiz(personal)
    const expanded = studyVocabularyQuestions(bank, { level: 'all', chapters: [], type: 'all' }, true)
    expect(new Set(expanded.map(item => item.chapter)).size).toBe(24)
    expect(new Set(expanded.map(item => item.id)).size).toBe(expanded.length)
    const keys = new Set(personal.sourceRows!.map(item => item.level.toLowerCase() + '-vocab:' + item.source_page))
    for (const item of expanded) {
      expect(keys.has(item.source.document + ':' + item.source.page)).toBe(true)
      expect(item.choices!.filter(choice => checkStudyAnswer(item, choice))).toHaveLength(1)
    }
    for (const chapter of pack.chapters) {
      const filter = { level: 'all', chapters: [chapter.id], type: 'all' } as const
      const scoped = { ...filter, chapters: [...filter.chapters] }
      const candidates = [...studyPool(pack, scoped), ...studyVocabularyQuestions(bank, scoped, true)]
        .filter(item => item.type !== 'writing' && item.type !== 'flashcard')
      for (const seed of [.13, .42, .71]) {
        const assessment = studyAssessment(candidates, 10, () => seed)
        expect(assessment).toHaveLength(10)
        expect(assessment.every(item => item.chapter === chapter.id)).toBe(true)
        expect(assessment.some(item => item.type === 'reading')).toBe(true)
        expect(assessment.some(item => item.type === 'vocabulary')).toBe(true)
      }
    }
    for (const mode of Object.keys(flashcardModes) as Array<keyof typeof flashcardModes>) {
      expect(vocabularyFlashcards(personal, { level: 'all', chapters: [], type: 'all' }, mode, true).length).toBeGreaterThan(0)
    }
  }, 20_000)
})
