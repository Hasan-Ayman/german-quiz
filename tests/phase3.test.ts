import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { rawPilot } from './fixtures'
import { levels, preferredExample, readAutomaticallyValidated, readVerifiedPilot } from '../src/pilot'
import { answer, buildCatalog, isCorrect, makeQuiz, modes, newAttempt, questionCounts, retryQuiz } from '../src/quiz'
import { loadAttempt, loadQuizSettings, saveAttempt } from '../src/storage'

const url = (name: string) => new URL('../data/' + name + '.json', import.meta.url)
const read = (name: string) => JSON.parse(readFileSync(url(name), 'utf8'))
const hasLocalBank = existsSync(url('phase3-local-quiz'))

function seeded(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

it('does not accept a structurally clean expansion candidate without a source review decision', () => {
  const [original] = rawPilot
  const row = {
    ...original, id: original.id + '-fixture', approval_status: 'approved',
    verification_status: 'automated_pass',
    sources: original.sources.map((source: object) => ({ ...source, verification_status: 'automated_pass' })),
  }
  expect(() => readVerifiedPilot(rawPilot, [], [row])).toThrow(/unverified/)
  expect(() => readVerifiedPilot([row])).toThrow(/unverified/)
})

describe.runIf(hasLocalBank)('local expansion from the actual reviewed bank', () => {
  const pilot = hasLocalBank ? read('verified-pilot') : []
  const entries = hasLocalBank ? readVerifiedPilot(pilot, read('authored-examples')) : []
  const groups = existsSync(url('distractor-groups')) ? read('distractor-groups') : []
  const localAuthored = hasLocalBank ? read('phase3-local-authored') : []
  const reviewed = hasLocalBank
    ? readVerifiedPilot(pilot, [...read('authored-examples'), ...localAuthored], read('phase3-local-quiz'))
    : []
  const hasAutomatic = existsSync(url('phase3-local-automatic-quiz'))
  const automatic = hasAutomatic ? readAutomaticallyValidated(read('phase3-local-automatic-quiz')) : []
  const autoIds = new Set(automatic.map(row => row.id))
  const reviewedCatalogs = { A1: buildCatalog(reviewed, 'A1', false, groups), A2: buildCatalog(reviewed, 'A2', false, groups) }
  const withAutomatic = new Map(levels.map(level => [level, buildCatalog([...reviewed, ...automatic], level, true, groups)]))

  it('preserves existing examples and never exposes a pending source example', () => {
    for (const original of entries) {
      const same = reviewed.find(entry => entry.id === original.id)
      expect(same?.examples).toEqual(original.examples)
    }
    const newEntries = reviewed.slice(entries.length)
    expect(newEntries.length).toBeGreaterThan(0)
    for (const entry of newEntries) {
      for (const example of entry.examples) {
        if (example.origin === 'source_pdf') {
          expect(example.verificationStatus).toBe('automated_checked')
        } else {
          expect(localAuthored).toContainEqual(expect.objectContaining({
            entryId: entry.id, german: example.german, arabic: example.arabic,
            verificationStatus: 'reviewed', review_method: 'user_review',
          }))
        }
      }
      expect(Boolean(preferredExample(entry.examples, 'A2'))).toBe(!entry.incompleteExampleLevels.includes('A2'))
    }
  })

  it('loads only the user-reviewed Phase 3 authored supplement in the local quiz', () => {
    const approvals = read('phase3-authored-approved')
    const pending = read('phase3-authored-proposal')
    expect(localAuthored).toHaveLength(approvals.length)
    for (const approval of approvals) {
      const record = localAuthored.find((item: { source_id: string }) => item.source_id === approval.source_id)
      expect(record).toMatchObject({
        german: approval.german, arabic: approval.arabic, origin: 'authored',
        verificationStatus: 'reviewed', review_method: 'user_review',
        source_pdf: expect.stringMatching(/^A[12]\.pdf$/), source_page: expect.any(Number),
      })
      expect(reviewed.find(entry => entry.id === record.entryId)?.examples).toContainEqual(expect.objectContaining({
        german: approval.german, arabic: approval.arabic, origin: 'authored',
      }))
      expect(entries.some(entry => entry.examples.some(example => example.german === approval.german))).toBe(false)
    }
    for (const proposal of pending) {
      expect(localAuthored.some((item: { source_id: string }) => item.source_id === proposal.source_id)).toBe(false)
    }
  })

  it.runIf(existsSync(new URL('../reports/phase3-scalable-review.json', import.meta.url)))(
    'keeps the automated and manual review queues outside the expanded quiz', () => {
      const report = JSON.parse(readFileSync(new URL('../reports/phase3-scalable-review.json', import.meta.url), 'utf8'))
      const ids = new Set(reviewed.map(entry => entry.id))
      const inactive = report.entries.filter((entry: { local_approval: string }) => entry.local_approval !== 'approved')
      expect(inactive).toHaveLength(report.summary.remaining_inactive)
      expect(inactive.some((entry: { entry_id: string }) => ids.has(entry.entry_id))).toBe(false)
      expect(report.summary.numbered_pdf_rows_matched).toBe(report.summary.source_rows)
      expect(report.authored_proposal_checks.every((proposal: { human_review: string }) =>
        proposal.human_review === 'pending_review')).toBe(true)
    },
  )

  it.runIf(hasAutomatic)('admits only explicitly authorized candidates and preserves their example status', () => {
    const readReport = (name: string) =>
      JSON.parse(readFileSync(new URL('../reports/' + name + '.json', import.meta.url), 'utf8'))
    const activation = readReport('phase3-local-activation')
    const review = readReport('phase3-scalable-review')
    const allowed = new Set<string>(review.entries.filter((item: { category: string; local_approval: string }) =>
      item.local_approval === 'pending_review' && item.category === 'automatically_validated_awaiting_publication_approval')
      .map((item: { entry_id: string }) => item.entry_id))
    expect(allowed.size).toBe(1211)
    expect(new Set([...autoIds, ...Object.keys(activation.excluded_before_catalog)])).toEqual(allowed)
    expect(reviewed.every(entry => !autoIds.has(entry.id))).toBe(true)
    expect(automatic.every(entry => !preferredExample(entry.examples, 'A2'))).toBe(true)
    const [row] = read('phase3-local-automatic-quiz')
    expect(() => readVerifiedPilot([], [], [row])).toThrow(/unverified/)
    expect(() => readAutomaticallyValidated([{ ...row, sources: [{ ...row.sources[0],
      verification_status: 'needs_manual_review' }] }])).toThrow(/unverified/)
  })

  it.runIf(hasAutomatic)('restores the reliability of an existing round independently of current settings', () => {
    const choice = '{"level":"A1","count":20,"reliability":"with-automatic"}'
    expect(loadQuizSettings(choice, true).reliability).toBe('with-automatic')
    expect(loadQuizSettings(choice).reliability).toBe('reviewed')
    const catalog = withAutomatic.get('A1')!
    const round = makeQuiz(catalog, seeded(20), 20)
    const wrong = round[0].choices.find(option => option.id !== round[0].correctId)!
    const attempt = answer(newAttempt(round, 'random', 'A1', 20, 'with-automatic'), wrong.id)
    const saved = saveAttempt(attempt, 'automatic')
    expect(loadAttempt(saved, reviewedCatalogs, 'reviewed')).toBeNull()
    const restored = loadAttempt(saved, reviewedCatalogs, 'reviewed', {
      getCatalog: level => withAutomatic.get(level)!, revision: 'automatic',
    })!
    expect(restored).toEqual(attempt)
    expect(retryQuiz(restored, seeded(4))[0]).toMatchObject({ id: round[0].id, correctId: round[0].correctId })
  })

  it.runIf(hasAutomatic)('deduplicates equivalent tested facts and blocks normalized Arabic collisions', () => {
    const [base, other] = automatic
    const duplicate = { ...base, id: base.id + '-duplicate', levels: ['A2'] as const }
    const sameGloss = { ...other, arabic_translations: base.arabic_translations.map(gloss => gloss.replace(/^ال/u, '')) }
    const fixture = buildCatalog([base, { ...duplicate, levels: [...duplicate.levels] }, sameGloss], 'A2', true)
    expect(fixture.equivalentEntries.get(duplicate.id)).toBe(base.id)
    expect(fixture.compatible(base.id, sameGloss.id)).toBe(false)
    for (const catalog of withAutomatic.values()) {
      const candidates = new Map([...catalog.facts.values()].map(({ entry }) => [entry.id, entry]))
      const identities = [...candidates.values()].map(entry =>
        JSON.stringify([entry.german, entry.part_of_speech, entry.article, [...entry.arabic_translations].sort()]))
      expect(new Set(identities).size).toBe(candidates.size)
      expect([...catalog.equivalentEntries.keys()].some(id => candidates.has(id))).toBe(false)
    }
  })

  it.each(levels.flatMap(level => [false, true].map(mixed => ({ level, mixed }))))(
    'generates safe full-length $level rounds (automatic = $mixed)', ({ level, mixed }) => {
    if (mixed && !hasAutomatic) return
    const catalog = mixed ? withAutomatic.get(level)! : reviewedCatalogs[level]
    const bank = mixed ? [...reviewed, ...automatic] : reviewed
    const inScope = new Set(bank.filter(entry => level === 'A2' || entry.levels.includes('A1')).map(entry => entry.id))
    expect(catalog.entryCount).toBeGreaterThanOrEqual(50)
    for (const count of questionCounts) {
      for (let seed = 1; seed <= 40; seed++) {
        const questions = makeQuiz(catalog, seeded(seed), count)
        expect(questions).toHaveLength(count)
        expect(new Set(questions.map(q => q.entry.id)).size).toBe(count)
        expect(new Set(questions.map(q => q.entry.german)).size).toBe(count)
        expect(new Set(questions.map(q => q.mode))).toEqual(new Set(modes))
        if (mixed) expect(questions.some(q => autoIds.has(q.entry.id))).toBe(true)
        for (const question of questions) {
          expect(inScope.has(question.entry.id)).toBe(true)
          expect(question.choices.filter(c => isCorrect(question, c.id))).toHaveLength(1)
          expect(new Set(question.choices.map(c => c.text)).size).toBe(question.choices.length)
          expect(question.choices).toHaveLength(question.mode === 'article' ? 3 : 4)
          if (question.mode === 'article') continue
          for (const [index, option] of question.choices.entries()) {
            expect(inScope.has(option.id)).toBe(true)
            expect(question.choices.slice(index + 1).every(c => catalog.compatible(c.id, option.id))).toBe(true)
          }
        }
      }
    }
  }, 30_000)
})
