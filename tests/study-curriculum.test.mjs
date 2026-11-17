import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const folder = process.env.GERMAN_QUIZ_STUDY_AUDIT

describe.runIf(Boolean(folder))('private four-source inventory', () => {
  it('accounts for every page and maps 12 chapters per textbook', () => {
    const read = name => JSON.parse(readFileSync(join(folder, name), 'utf8'))
    const { sources, chapters } = read('curriculum-private.json')
    const archive = read('page-inventory-private.json')
    expect(sources.map(source => source.pages)).toEqual([276, 292, 62, 50])
    expect(sources.map(source => source.textPages)).toEqual([273, 289, 62, 50])
    for (const source of sources) {
      const pages = archive[source.id]
      expect(pages.map(page => page.page)).toEqual(Array.from({ length: source.pages }, (_, i) => i + 1))
      expect(source.sha256).toMatch(/^[a-f0-9]{64}$/u)
      expect(pages.filter(page => !page.hasText).map(page => page.page)).toEqual(source.visualReviewPages)
    }
    for (const level of ['A1', 'A2']) {
      const scope = chapters.filter(chapter => chapter.id.startsWith(level))
      expect(scope.map(chapter => chapter.number)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
      for (const [index, chapter] of scope.entries()) {
        expect(chapter.startPage).toBe(chapter.printedStart + 2)
        expect(chapter.endPage).toBe(chapter.printedEnd + 2)
        expect(chapter.assessmentPage).toBe(chapter.endPage)
        expect(chapter.workbookPage).toBeGreaterThan(chapter.startPage)
        expect(chapter.summaryPage).toBeGreaterThan(chapter.workbookPage)
        expect(chapter.endPage).toBeGreaterThan(chapter.summaryPage)
        for (const key of ['objectives', 'themes', 'grammar', 'pronunciation']) {
          expect(chapter[key].every(value => value.trim())).toBe(true)
          expect(chapter[key].length).toBeGreaterThan(0)
        }
        if (index) expect(chapter.startPage).toBe(scope[index - 1].endPage + 1)
      }
      expect(scope.at(-1).endPage + 1).toBe(sources.find(source => source.id === scope[0].source).appendix.exam)
    }
  })
})
