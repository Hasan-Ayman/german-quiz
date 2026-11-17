import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { educationFormat, educationVersion, readEducationFile, validateEducationPackage } from '../src/education-package'
import { preparePersonalQuiz } from '../src/personal-quiz'
import { fixtureDataset } from './fixtures'

it('rejects unsupported or incomplete wrappers and invalid embedded sections', () => {
  const header = { format: educationFormat, version: educationVersion }
  expect(() => validateEducationPackage(fixtureDataset)).toThrow(expect.objectContaining({ code: 'schema' }))
  expect(() => validateEducationPackage({ ...header, version: 2 })).toThrow(expect.objectContaining({ code: 'schema' }))
  expect(() => validateEducationPackage({ ...header, vocabulary: fixtureDataset })).toThrow(expect.objectContaining({ code: 'missing' }))
  expect(() => validateEducationPackage({ ...header, vocabulary: {}, study: {} })).toThrow(expect.objectContaining({ code: 'schema' }))
  expect(() => validateEducationPackage({ ...header, vocabulary: fixtureDataset, study: {} })).toThrow(expect.objectContaining({ code: 'study' }))
})

it('rejects corrupted JSON and invalid text encoding before validation', async () => {
  await expect(readEducationFile(new File(['{'], 'incomplete.json'))).rejects.toMatchObject({ code: 'syntax' })
  await expect(readEducationFile(new File([new Uint8Array([0xff, 0x00])], 'damaged.json'))).rejects.toMatchObject({ code: 'encoding' })
})

const packageFile = process.env.GERMAN_QUIZ_EDUCATION_TEST_FILE
const vocabularyFile = process.env.GERMAN_QUIZ_V2_TEST_FILE
const studyFolder = process.env.GERMAN_QUIZ_STUDY_AUDIT

describe.runIf(Boolean(packageFile && vocabularyFile && studyFolder))('complete unified education file', () => {
  it('preserves both original payloads including individual source rows, metadata and review statuses', async () => {
    const [raw, vocabulary, study] = await Promise.all([packageFile!, vocabularyFile!, join(studyFolder!, 'german-quiz-study-private.json')]
      .map(async path => JSON.parse(await readFile(path, 'utf8'))))
    const content = validateEducationPackage(raw)
    expect(raw.vocabulary).toEqual(vocabulary)
    expect(raw.study).toEqual(study)
    expect(content.vocabulary).toEqual(vocabulary)
    expect(content.study).toEqual(study)
    expect(content.vocabulary.sourceRows?.some(row => row.verification_status === 'needs_manual_review')).toBe(true)
    const bank = await preparePersonalQuiz(content.vocabulary)
    const eligible = new Set([...bank.getExpandedCatalog('A2').facts.values()].map(fact => fact.entry.id))
    const admitted = new Set(content.vocabulary.entries.map(entry => entry.id))
    expect([...eligible].every(id => admitted.has(id))).toBe(true)
    expect(content.study.chapters).toHaveLength(24)
    expect(new Set(content.study.questions.map(item => item.type)).size).toBe(10)
  })
})
