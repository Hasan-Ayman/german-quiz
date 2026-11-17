import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const folder = process.env.GERMAN_QUIZ_STUDY_AUDIT
describe.runIf(Boolean(folder))('editorially checked private practice material', () => {
  it('ties bilingual material for all chapters to a valid source and a supported answer', () => {
    const pack = JSON.parse(readFileSync(join(folder, 'german-quiz-study-private.json'), 'utf8'))
    expect(new Set(pack.questions.map(item => item.id)).size).toBe(pack.questions.length)
    expect(new Set(pack.lessons.map(item => item.chapter)).size).toBe(24)
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
})
