import { expect, it } from 'vitest'
import { readPersonalFile, serializePersonalDataset, validatePersonalDataset } from '../src/personal-data'
import { preparePersonalQuiz, selectedPersonalCatalog } from '../src/personal-quiz'
import { makeQuiz } from '../src/quiz'
import { fixtureDataset } from './fixtures'
import { importMessage } from '../src/import-problem'

it('round-trips the complete versioned vocabulary and metadata', async () => {
  const text = serializePersonalDataset(fixtureDataset)
  const file = new File(['\uFEFF', text], 'german-quiz-personal-vocabulary.json')
  expect(await readPersonalFile(file)).toEqual(fixtureDataset)
})

it('rejects malformed, oversized and incompatible files', async () => {
  for (const content of ['', '{bad', '[]', '{"format":"german-quiz-personal","version":2,"entries":[]}']) {
    await expect(readPersonalFile(new File([content], 'test.json'))).rejects.toThrow()
  }
  await expect(readPersonalFile({ size: 50_000_000, text: async () => {
    throw new Error('Should never read an oversized file')
  } })).rejects.toThrow(/size/)
})

it('distinguishes file failures from schema, missing fields and invalid records', async () => {
  const cases = [
    ['{bad', 'syntax', undefined, undefined],
    ['{"format":"german-quiz-personal","version":8}', 'schema', undefined, undefined],
    [JSON.stringify({ ...fixtureDataset, entries: undefined }), 'missing', 'entries', undefined],
    [JSON.stringify({ ...fixtureDataset, entries: [{ ...fixtureDataset.entries[0], german: undefined }] }),
      'missing', 'german', 1],
    [JSON.stringify({ ...fixtureDataset, entries: [{ ...fixtureDataset.entries[0], part_of_speech: 'private-value' }] }),
      'record', undefined, 1],
  ] as const
  for (const [text, code, field, row] of cases) {
    const failed = readPersonalFile(new File([text], 'test.json'))
    await expect(failed).rejects.toMatchObject({ code, field, row })
    expect(await failed.catch(importMessage)).not.toContain('private-value')
  }
  await expect(readPersonalFile({ size: 1, text: async () => { throw new Error('private path') } }))
    .rejects.toMatchObject({ code: 'read' })
  await expect(readPersonalFile(new File([Uint8Array.of(0x80)], 'test.json')))
    .rejects.toMatchObject({ code: 'encoding' })
})

it('reads UTF-16 transfer files and preserves fields through export and re-import', async () => {
  const input = {
    ...fixtureDataset, transferMetadata: { batch: 2 },
    entries: fixtureDataset.entries.map(row => ({
      ...row, entryNotes: ['test'], quiz: { ...row.quiz, setting: true },
      sources: row.sources.map(source => ({ ...source, sourceNote: 'test' })),
      examples: row.examples.map(example => ({ ...example, exampleNote: 'test' })),
    })),
  }
  const bytes = Buffer.from('\uFEFF' + JSON.stringify(input), 'utf16le')
  const parsed = await readPersonalFile(new File([new Uint8Array(bytes)], 'test.json'))
  expect(parsed).toEqual(input)
  expect(validatePersonalDataset(JSON.parse(serializePersonalDataset(parsed)))).toEqual(input)
})

it('rejects duplicate IDs, invalid level metadata, impossible eligibility and unapproved examples', () => {
  const [row] = fixtureDataset.entries
  for (const entries of [
    [row, row],
    [{ ...row, levels: ['A2'] }],
    [{ ...row, part_of_speech: 'verb' }],
    [{ ...row, quiz: { ...row.quiz, arabic_to_german_prompts: ['bad'] } }],
    [{ ...row, examples: [{ entryId: row.id, origin: 'authored', level: 'A1',
      german: 'Ein Test.', arabic: 'اختبار.', verificationStatus: 'needs_manual_review' }] }],
  ]) {
    expect(() => validatePersonalDataset({ ...fixtureDataset, entries })).toThrow(/entry/)
  }
})

it('keeps reviewed, expanded and source level choices distinct after importing', async () => {
  const bank = await preparePersonalQuiz(fixtureDataset)
  const a1 = selectedPersonalCatalog(bank, { level: 'A1', count: 30, reliability: 'with-automatic' })
  const reviewed = selectedPersonalCatalog(bank, { level: 'A2', count: 50, reliability: 'reviewed' })
  const a2 = selectedPersonalCatalog(bank, { level: 'A2', count: 50, reliability: 'with-automatic' })
  expect([...a1.facts.values()].every(fact => fact.entry.levels.includes('A1'))).toBe(true)
  expect(reviewed.entryCount).toBeLessThan(a2.entryCount)
  expect(makeQuiz(a2, () => .53, 50)).toHaveLength(50)
})
