import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateEducationPackage } from '../src/education-package'
import { availableStudyQuestions, makeSourceQuestion, sourceFields, validateSourceQuestions } from '../src/source-questions'
import { checkStudyAnswer } from '../src/study-engine'
import { preparePersonalQuiz } from '../src/personal-quiz'
import { fromStudyQuestion, eligiblePractice, loadPracticePreferences, practiceChapters, questionGroups } from '../src/practice'
import { adaptiveRound, buildEvidence } from '../src/learning-model'

const file = process.env.GERMAN_QUIZ_SOURCE_EXPANSION
describe.runIf(Boolean(file))('complete private four-source expansion', () => {
  const raw = file ? JSON.parse(readFileSync(file, 'utf8')) : null
  const content = raw && validateEducationPackage(raw)
  const oldPath = process.env.GERMAN_QUIZ_SOURCE_BASELINE
  const baseline = oldPath && JSON.parse(readFileSync(oldPath, 'utf8'))
  const coverage = file && JSON.parse(readFileSync(file.replace(/[^\\/]+$/u, 'coverage-statistics.json'), 'utf8'))
  it('keeps every legacy identity and metadata field while adding questions with actual PDF pages', () => {
    expect(content.vocabulary).toEqual(baseline.vocabulary)
    expect(content.study.chapters).toEqual(baseline.study.chapters)
    expect(content.study.lessons).toEqual(baseline.study.lessons)
    expect(content.study.questions.slice(0, baseline.study.questions.length)).toEqual(baseline.study.questions)
    expect(content.study.questions.length).toBeGreaterThan(2000)
    expect(content.study.questions.filter((q: { type: string }) => q.type === 'writing')).toHaveLength(24)
    expect(new Set(content.study.questions.map((q: { id: string }) => q.id)).size).toBe(content.study.questions.length)
  })
  it('rejects fabricated source forms, wrong references and question eligibility changes', () => {
    const clone = () => structuredClone(raw)
    for (const field of ['answers', 'source', 'instruction', 'activity']) {
      const invalid = clone()
      const target = invalid.study.questions.find((q: { sourceEvidence?: unknown }) => q.sourceEvidence)
      if (field === 'answers') target.answers = ['invented']
      else if (field === 'source') target.source.page = 1
      else if (field === 'activity') target.activity = 'reading'
      else target.instruction += ' changed'
      expect(() => validateEducationPackage(invalid)).toThrow()
    }
    const form = content.study.questions.find((q: { sourceEvidence?: unknown }) => q.sourceEvidence)
    const row = content.vocabulary.sourceRows.find((r: { id: string }) => r.id === form.sourceEvidence.rowId)
    const entry = content.vocabulary.entries.find((e: { id: string }) => e.id === form.sourceEvidence.entryId)
    expect(makeSourceQuestion(entry, { ...row, validation_issues: ['uncertain'] }, form.sourceEvidence.field)).toBeNull()
    expect(makeSourceQuestion(entry, { ...row, verification_status: 'needs_manual_review' }, form.sourceEvidence.field)).toBeNull()
  })
  it('grades every new item and retains the full source-reading relationships', () => {
    for (const question of content.study.questions) {
      if (question.origin !== 'source_derived') continue
      expect(checkStudyAnswer(question, question.answers[0])).toBe(true)
      expect(checkStudyAnswer(question, 'WRONG 123')).toBe(false)
      if (question.choices) expect(question.choices.filter((choice: string) => checkStudyAnswer(question, choice))).toHaveLength(1)
      if (question.sourceEvidence) {
        const row = content.vocabulary.sourceRows.find((r: { id: string }) => r.id === question.sourceEvidence.rowId)
        expect(sourceFields).toContain(question.sourceEvidence.field)
        expect(question.answers).toEqual([row[question.sourceEvidence.field]])
      } else {
        const passage = content.study.readingPassages.find((p: { id: string }) => p.id === question.passageRef)
        expect(question.prompt).toBe(passage.german)
        expect(passage.german).toContain(question.readingEvidence)
        expect(question.passageArabic).toBe(passage.arabic)
      }
    }
    const corrupted = structuredClone(content.study.questions.filter((q: { type: string; origin: string }) => q.type === 'reading' && q.origin === 'source_derived'))
    corrupted[0].readingEvidence = 'Not a source sentence'
    expect(() => validateSourceQuestions(corrupted, content.vocabulary, content.study.readingPassages)).toThrow()
  })
  it('respects reviewed-only mode and runs 504 unique, scoped seeded expanded rounds', async () => {
    const bank = await preparePersonalQuiz(content.vocabulary)
    const chapters = practiceChapters(bank, content.study)
    const pool: ReturnType<typeof fromStudyQuestion>[] = content.study.questions.map(fromStudyQuestion)
    expect(new Set(pool.filter(item => item.activity !== 'writing').map(item => item.key)).size).toBe(coverage.storedUniqueFactsExpanded.combined)
    const prefs = loadPracticePreferences(null, null)
    const reviewed = new Set(bank.dataset.entries.filter(entry => entry.vocabularyStatus === 'reviewed').map(entry => entry.id))
    const active = availableStudyQuestions(content.study.questions, content.vocabulary.entries, false)
    expect(active.filter(q => q.origin === 'source_derived' && q.type === 'reading')).toHaveLength(8)
    expect(availableStudyQuestions(content.study.questions, content.vocabulary.entries, true).every(q => q.type !== 'writing')).toBe(true)
    expect(active.some((q: { sourceEvidence?: { entryId: string } }) => q.sourceEvidence && !reviewed.has(q.sourceEvidence.entryId))).toBe(false)
    for (let seed = 0; seed < 504; seed++) {
      const level = ['A1', 'A2', 'all'][seed % 3]
      const chosen = chapters.filter(ch => level === 'all' || ch.level === level).map(ch => ch.id)
      const eligible = eligiblePractice(pool, chosen, prefs, new Set(), new Map())
      expect(eligible.some(item => item.activity === 'writing')).toBe(false)
      const count = [10, 20, 30, 50][seed % 4] as 10 | 20 | 30 | 50
      const round = adaptiveRound(questionGroups(eligible), count, buildEvidence([]), 1700000000000, seed)
      expect(round).toHaveLength(count)
      expect(new Set(round.map(item => item.key)).size).toBe(count)
      expect(round.every(item => chosen.includes(item.chapter as typeof chosen[number]))).toBe(true)
    }
  })
})
