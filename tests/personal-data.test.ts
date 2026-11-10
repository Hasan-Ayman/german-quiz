import { expect, it } from 'vitest'
import { readPersonalFile, serializePersonalDataset, validatePersonalDataset } from '../src/personal-data'
import { preparePersonalQuiz, selectedPersonalCatalog } from '../src/personal-quiz'
import { makeQuiz } from '../src/quiz'
import { fixtureDataset } from './fixtures'

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
