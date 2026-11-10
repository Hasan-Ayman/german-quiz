import { expect, it } from 'vitest'
import { entries, rawPilot } from './fixtures'
import { addApprovedLocalExamples, levels, preferredExample, readVerifiedPilot } from '../src/pilot'
import { buildCatalog } from '../src/quiz'

interface RawSource {
  level: string
  source_pdf: string
  chapter_number: number
  source_page: number
  verification_status: string
  example_sentence: string | null
  example_arabic_translation?: string
}

const raw: { id: string; german: string; sources: RawSource[] }[] =
  rawPilot

it('gives every eligible entry an approved example or an explicit incomplete flag for its level', () => {
  for (const level of levels) {
    const catalog = buildCatalog(entries, level)
    for (const { entry } of catalog.facts.values()) {
      const example = preferredExample(entry.examples, level)
      expect(entry.incompleteExampleLevels.includes(level)).toBe(!example)
      if (example?.origin === 'authored') {
        expect(example).toMatchObject({ entryId: entry.id, verificationStatus: 'reviewed' })
        expect(example.arabic).toMatch(/\p{Script=Arabic}/u)
      }
    }
  }
})

it('preserves every verified PDF example and its provenance exactly', () => {
  for (const entry of entries) {
    const original = raw.find(row => row.id === entry.id)!
    expect(entry.examples.filter(example => example.origin === 'source_pdf')).toEqual(
      original.sources.filter(source => source.verification_status === 'manually_verified' && source.example_sentence)
        .map(source => ({
          entryId: entry.id, origin: 'source_pdf', verificationStatus: 'manually_verified',
          german: source.example_sentence, arabic: source.example_arabic_translation ?? null,
          level: source.level, sourcePdf: source.source_pdf,
          chapter: source.chapter_number, page: source.source_page,
        })),
    )
  }
})

it('prefers the PDF when a shared entry also has a reviewed fallback for A1', () => {
  const row = raw.find(entry => entry.german === 'aktiv')!
  const fallback = {
    entryId: row.id, level: 'A1', origin: 'authored', verificationStatus: 'reviewed',
    german: 'Beispielsatz für den Test.', arabic: 'جملة للاختبار.',
  }
  const [entry] = readVerifiedPilot([row], [fallback])
  expect(preferredExample(entry.examples, 'A1')).toEqual(fallback)
  expect(preferredExample([...entry.examples].reverse(), 'A2')).toMatchObject({
    origin: 'source_pdf', verificationStatus: 'manually_verified', level: 'A2',
    german: row.sources.find(source => source.level === 'A2')!.example_sentence,
  })
})

it('flags a missing or pending fallback without promoting it to a verified PDF example', () => {
  const [row] = raw
  const [entry] = readVerifiedPilot([row])
  expect(entry.incompleteExampleLevels).toEqual(['A1', 'A2'])
  expect(preferredExample(entry.examples, 'A1')).toBeUndefined()
  const [pending] = readVerifiedPilot([row], [{
    entryId: row.id, origin: 'authored', level: 'A1', verificationStatus: 'needs_manual_review',
    german: 'Beispielsatz für den Test.', arabic: null,
  }])
  expect(pending.incompleteExampleLevels).toEqual(entry.incompleteExampleLevels)
  expect(pending.examples).toEqual([])
})

it('ignores unapproved local examples, protects existing examples and respects the source level', () => {
  const [missing] = readVerifiedPilot([raw[0]])
  const existing = entries.find(entry => entry.examples.length)!
  const level = missing.levels[0]
  const row = {
    entryId: missing.id, level, origin: 'source_pdf', german: 'Das ist ein Beispielsatz.',
    arabic: 'هذه جملة مثال.', arabicOrigin: 'authored', sourceId: level.toLowerCase() + '-01-verb-01',
    sourcePdf: level + '.pdf', page: 4, chapter: 1, status: 'human_approved',
    decision: { decision: 'approve', reviewer: 'Fixture reviewer', reason: 'Checked', fingerprint: 'a'.repeat(64),
      checks: { germanGrammar: true, naturalness: true, cefr: true, arabicAccuracy: true, semanticFit: true } },
  }
  const [stillMissing, stillExisting] = addApprovedLocalExamples([missing, existing], [
    { ...row, status: 'automated_checked' },
    { ...row, entryId: existing.id, level: existing.examples[0].level,
      sourcePdf: existing.examples[0].level + '.pdf', sourceId: existing.examples[0].level.toLowerCase() + '-01-verb-01' },
  ])
  expect(stillMissing).toBe(missing)
  expect(stillExisting).toBe(existing)
  const [updated] = addApprovedLocalExamples([missing], [row, row])
  expect(updated.examples).toHaveLength(1)
  expect(preferredExample(updated.examples, 'A2')).toMatchObject({
    origin: 'source_pdf', arabicOrigin: 'authored', verificationStatus: 'automated_checked',
  })
  expect(Boolean(preferredExample(updated.examples, 'A1'))).toBe(level === 'A1')
})

it('keeps machine approvals distinct and adds Arabic only to the exact untranslated PDF example', () => {
  const original = entries.find(entry => entry.examples.some(example => example.origin === 'source_pdf' && !example.arabic))!
  const pdf = original.examples.find(example => example.origin === 'source_pdf' && !example.arabic)!
  if (pdf.origin !== 'source_pdf') throw new Error('Missing PDF fixture')
  const row = {
    entryId: original.id, level: pdf.level, origin: 'source_pdf', german: pdf.german,
    arabic: 'هذه ترجمة للاختبار.', arabicOrigin: 'authored', operation: 'translate_existing_pdf',
    sourceId: pdf.level.toLowerCase() + '-' + String(pdf.chapter).padStart(2, '0') + '-verb-01',
    sourcePdf: pdf.sourcePdf, page: pdf.page, chapter: pdf.chapter,
    status: 'automated_approved_for_local_use',
    decision: {
      decision: 'approve_local_automated', method: 'fixture', fingerprint: 'b'.repeat(64),
      checks: { germanGrammar: true, naturalness: true, cefr: true, arabicAccuracy: true, semanticFit: true,
        targetUsage: true, structure: true },
    },
  }
  expect(addApprovedLocalExamples([original], [{ ...row, german: pdf.german + ' X' }])[0]).toBe(original)
  const [translated] = addApprovedLocalExamples([original], [row])
  expect(translated.examples.find(example => example.german === pdf.german)).toMatchObject({
    ...pdf, arabic: row.arabic, arabicOrigin: 'authored', arabicLocalApproval: row.status,
  })
  expect(addApprovedLocalExamples([translated], [{ ...row, arabic: 'هذه ترجمة بديلة.' }])[0]).toBe(translated)
})
