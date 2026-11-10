import { mkdtempSync, rmdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { approvedSupplement, applyDecisions, checkpointDrafts, makePlan } from '../scripts/example_review.mjs'
import { checkExample, targetEvidence } from '../scripts/validate_example.mjs'
import { evaluateForLocalUse, evidenceFingerprint, languageChecks } from '../scripts/local_example_approval.mjs'

const checks = { germanGrammar: true, naturalness: true, cefr: true, arabicAccuracy: true, semanticFit: true }
const dependencyDir = fileURLToPath(new URL('../node_modules', import.meta.url))
const source = {
  id: 'a1-99-noun-01', german: 'Hund', article: 'der', plural: 'die Hunde', part_of_speech: 'noun',
  source_pdf: 'A1.pdf', source_page: 13, chapter_number: 99, level: 'A1', source_bbox: [1, 2, 3, 4],
  review_fingerprint: 'source-row-v1',
}
const draft = {
  entryId: 'dog', sourceId: source.id, level: 'A1', origin: 'authored',
  german: 'Der Hund spielt im Garten.', arabic: 'يلعب الكلب في الحديقة.', arabicOrigin: 'authored',
}
const job = { id: 'dog', level: 'A1', entry: { ...source, arabic_translations: ['الكلب'] }, sources: [source], pdf: [] }
const queue = { jobs: new Map([[job.id, job], ['dog2', { ...job, id: 'dog2' }]]) }
const audit = { examples: {} }

it('recognizes source plurals, inflected adjectives, and separable and reflexive verbs', () => {
  expect(targetEvidence(source, 'Die Hunde spielen.')).toBe('source_plural_or_weak_form')
  expect(targetEvidence({ german: 'direkt', part_of_speech: 'adjective' }, 'Wir nehmen einen direkten Zug.'))
    .toBe('adjective_inflection_candidate')
  expect(targetEvidence({
    german: 'abfahren', part_of_speech: 'verb', preterite: 'fuhr ab', perfect: 'ist abgefahren',
  }, 'Der Zug fährt morgen ab.')).toBe('separated_verb_candidate')
  expect(targetEvidence({
    german: 'anfangen', part_of_speech: 'verb', preterite: 'fing an',
  }, 'Der Kurs fängt gleich an.')).toBe('separated_verb_candidate')
  expect(targetEvidence({ german: 'dunkel', part_of_speech: 'adjective' }, 'Ich trage eine dunkle Hose.'))
    .toBe('adjective_inflection_candidate')
  expect(targetEvidence({ german: 'Großvater / der Opa', part_of_speech: 'noun' }, 'Mein Opa wohnt hier.'))
    .toBe('source_headword_alternative')
  const reflexive = { german: 'sich bewerben (um / bei)', part_of_speech: 'verb', perfect: 'hat sich beworben' }
  expect(targetEvidence(reflexive, 'Ich habe mich gestern beworben.')).toBe('source_participle')
  expect(targetEvidence(reflexive, 'Wir haben viele Produkte beworben.')).toBeNull()
  expect(targetEvidence(source, 'Ich sehe eine Katze.')).toBeNull()
})

it('requires an eligible, level-matched source, valid scripts, and an authored Arabic sentence', () => {
  expect(checkExample(draft, job, audit).status).toBe('automated_checked')
  expect(checkExample({ ...draft, arabic: '' }, job, audit).errors).toContain('missing_or_invalid_arabic_text')
  expect(checkExample({ ...draft, german: 'Der Hund يلعب.' }, job, audit).errors).toContain('invalid_german_text')
  expect(checkExample({ ...draft, level: 'A2' }, job, audit).errors).toContain('invalid_job_or_source')
  expect(checkExample({ ...draft, german: 'Das Hund spielt.' }, job, audit).flags).toContain('check_noun_article_agreement')
})

it('requires exact draft-bound language evidence for an automatic local approval', () => {
  const evidence = {
    fingerprint: evidenceFingerprint(draft), method: 'fixture-checker',
    checks: Object.fromEntries(languageChecks.map(key => [key, true])),
  }
  expect(evaluateForLocalUse(draft, job, audit, null, evidence)).toMatchObject({
    status: 'automated_approved_for_local_use', decision: { decision: 'approve_local_automated' },
  })
  expect(evaluateForLocalUse(draft, job, audit, null, { ...evidence,
    checks: { ...evidence.checks, arabicAccuracy: false },
  }).failedChecks).toContain('arabicAccuracy')
  expect(evaluateForLocalUse({ ...draft, arabic: 'القطة في الحديقة.' }, job, audit, null, evidence).status)
    .toBe('needs_manual_review')
  expect(evaluateForLocalUse(draft, job, audit, null, null).failedChecks).toEqual(languageChecks)
})

it('requires exact German PDF text, its own layout evidence, and separate Arabic provenance', () => {
  const pdfDraft = { ...draft, origin: 'source_pdf', sourceAssociation: 'ai_visual_checked' }
  const pdfJob = {
    ...job, sources: [{ ...source, example_sentence: draft.german }],
    pdf: [{ source_id: source.id, german: draft.german }],
  }
  const layout = { examples: { [source.id]: {
    german: draft.german, fingerprint: source.review_fingerprint,
    numbered_row_marker_matches: true, extracted_band_matches: true,
  } } }
  expect(checkExample(pdfDraft, pdfJob, layout).errors).toEqual([])
  expect(checkExample({ ...pdfDraft, german: 'Der Hund schläft.' }, pdfJob, layout).errors)
    .toContain('source_sentence_or_layout_mismatch')
  expect(checkExample({ ...pdfDraft, arabicOrigin: 'source_pdf' }, pdfJob, layout).errors)
    .toContain('invalid_arabic_provenance')
  expect(checkExample(pdfDraft, pdfJob, audit).errors).toContain('source_sentence_or_layout_mismatch')
  expect(checkExample(draft, pdfJob, layout).flags).toContain('review_original_before_authored_fallback')
})

it('creates deterministic batches of up to 100 without reusing a pilot ID', () => {
  const jobs = Array.from({ length: 242 }, (_, i) => {
    const id = String(i).padStart(3, '0')
    return [id, { ...job, id }]
  })
  const pilot = jobs.slice(0, 30).map(([id]) => id)
  const plan = makePlan({ jobs: new Map(jobs) }, pilot)
  expect(Object.values(plan.batches).map(batch => batch.length)).toEqual([30, 100, 100, 12])
  expect(new Set(Object.values(plan.batches).flat()).size).toBe(242)
  expect(makePlan({ jobs: new Map(jobs) }, pilot)).toEqual(plan)
})

it('resumes a partial checkpoint and logs duplicate or conflicting drafts without replacing saved examples', () => {
  const dir = mkdtempSync(join(dependencyDir, 'german-quiz-examples-'))
  try {
    const ids = ['dog', 'dog2']
    const first = checkpointDrafts(dir, 'pilot', ids, [draft], queue, audit)
    expect(first.records).toHaveLength(1)
    const secondDraft = { ...draft, entryId: 'dog2' }
    const resumed = checkpointDrafts(dir, 'pilot', ids, [
      { ...draft, german: 'Der Hund rennt.' }, secondDraft, secondDraft,
    ], queue, audit)
    expect(resumed.records.map(row => row.entryId)).toEqual(ids)
    expect(resumed.records[0]).toEqual(first.records[0])
    expect(resumed.errors.map(error => error.reason)).toEqual(['already_checkpointed_use_review_edit', 'duplicate_input'])
    expect(checkpointDrafts(dir, 'pilot', ids, [draft, secondDraft], queue, audit).records).toEqual(resumed.records)
  } finally {
    rmSync(join(dir, 'pilot.json'), { force: true })
    rmdirSync(dir)
  }
})

it('only projects explicit fingerprint-bound approvals and invalidates stale decisions after edits', () => {
  const dir = mkdtempSync(join(dependencyDir, 'german-quiz-decisions-'))
  try {
    const state = checkpointDrafts(dir, 'pilot', ['dog'], [draft], queue, audit)
    const original = state.records[0]
    const review = { entryId: 'dog', fingerprint: original.fingerprint, reviewer: 'Fixture reviewer', reason: 'Checked' }
    expect(approvedSupplement(state.records, queue)).toEqual([])
    expect(applyDecisions(state, [{ ...review, decision: 'approve' }], queue, audit).records[0].status)
      .toBe('automated_checked')
    const edited = applyDecisions(state, [{ ...review, decision: 'edit', editedGerman: 'Der Hund rennt.' }], queue, audit)
    expect(edited.records[0].fingerprint).not.toBe(original.fingerprint)
    expect(applyDecisions(edited, [{ ...review, checks, decision: 'approve' }], queue, audit).errors).toHaveLength(1)
    const rejected = applyDecisions(state, [{ ...review, decision: 'reject' }], queue, audit)
    expect(rejected.records[0].status).toBe('rejected')
    expect(approvedSupplement(rejected.records, queue)).toEqual([])
    const approved = applyDecisions(state, [{ ...review, checks, decision: 'approve' }], queue, audit)
    expect(approvedSupplement(approved.records, queue)[0]).toMatchObject({
      entryId: 'dog', status: 'human_approved', sourcePdf: 'A1.pdf', german: draft.german, arabic: draft.arabic,
    })
    expect(applyDecisions(approved, [{ ...review, decision: 'edit' }], queue, audit).records).toEqual(approved.records)
  } finally {
    rmSync(join(dir, 'pilot.json'), { force: true })
    rmdirSync(dir)
  }
})
