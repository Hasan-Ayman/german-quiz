import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { preferredExample, readAutomaticallyValidated, readVerifiedPilot } from '../src/pilot.ts'
import { buildCatalog } from '../src/quiz.ts'
import { readDistractorGroups } from './read_distractor_groups.mjs'

export const readJson = path => JSON.parse(readFileSync(path, 'utf8'))

export function exampleQueue(root) {
  const distractorGroups = readDistractorGroups(root)
  const read = (dir, name) => readJson(join(root, dir, name + '.json'))
  const reviewed = readVerifiedPilot(read('data', 'verified-pilot'),
    [...read('data', 'authored-examples'), ...read('data', 'phase3-local-authored')],
    read('data', 'phase3-local-quiz'))
  const automatic = readAutomaticallyValidated(read('data', 'phase3-local-automatic-quiz'))
  const pool = [...reviewed, ...automatic]
  const existingSentences = pool.flatMap(entry => entry.examples.map(example => example.german))
  const rows = read('data', 'phase3-source-rows')
  const inventory = read('reports', 'phase3-example-coverage').examples
  const pdfByRow = new Map(inventory.filter(example => example.origin === 'source_pdf')
    .map(example => [example.source_id, example]))
  const coverage = {}
  const jobs = new Map()
  const missingTranslations = new Map()
  for (const [mode, entries] of [['reviewed', reviewed], ['expanded', pool]]) {
    coverage[mode] = {}
    for (const level of ['A1', 'A2']) {
      const catalog = buildCatalog(entries, level, mode === 'expanded', distractorGroups)
      const eligible = new Map([...catalog.facts.values()].map(({ entry }) => [entry.id, entry]))
      const counts = { eligible: eligible.size, source_pdf: 0, authored: 0, missing: 0 }
      const aliases = new Map()
      for (const [alias, canonical] of catalog.equivalentEntries) {
        const keys = aliases.get(canonical) ?? []
        keys.push(alias)
        aliases.set(canonical, keys)
      }
      for (const entry of eligible.values()) {
        const approved = preferredExample(entry.examples, level)
        counts[approved?.origin ?? 'missing']++
        if (approved) {
          if (approved.origin === 'source_pdf' && !approved.arabic) {
            missingTranslations.set(JSON.stringify([entry.id, approved.level, approved.page, approved.german]),
              { entry, example: approved })
          }
          continue
        }
        // An A1 example also fits A2. A review-only canonical ID may differ
        // from the expanded ID, so derive eligibility from both actual catalogs.
        const targetLevel = entry.levels.includes('A1') ? 'A1' : 'A2'
        const prior = jobs.get(entry.id)
        const keys = new Set([entry.id, ...(prior?.equivalent_ids ?? []), ...(aliases.get(entry.id) ?? [])])
        jobs.set(entry.id, {
          id: entry.id, level: targetLevel, entry, equivalent_ids: [...keys],
        })
      }
      coverage[mode][level] = counts
    }
  }
  const byEntry = new Map()
  for (const row of rows) {
    const group = byEntry.get(row.combined_id) ?? []
    group.push(row)
    byEntry.set(row.combined_id, group)
  }
  for (const job of jobs.values()) {
    job.sources = job.equivalent_ids.flatMap(id => byEntry.get(id) ?? []).filter(row =>
      row.level === job.level && !row.validation_issues.length &&
      row.approval_status !== 'rejected' && row.verification_status !== 'needs_manual_review' &&
      row.german === job.entry.german && row.article === job.entry.article &&
      row.part_of_speech === job.entry.part_of_speech &&
      JSON.stringify([...row.arabic_translations].sort()) === JSON.stringify([...job.entry.arabic_translations].sort()))
      .sort((a, b) => a.id.localeCompare(b.id))
    job.pdf = job.sources.filter(row => pdfByRow.has(row.id)).map(row => pdfByRow.get(row.id))
  }
  const translationJobs = new Map()
  for (const [key, { entry, example }] of missingTranslations) {
    const source = (byEntry.get(entry.id) ?? []).find(row => row.level === example.level &&
      row.source_pdf === example.sourcePdf && row.source_page === example.page &&
      row.chapter_number === example.chapter && row.example_sentence === example.german && pdfByRow.has(row.id))
    if (source) translationJobs.set(key, {
      id: entry.id, level: example.level, entry, sources: [source],
      pdf: [pdfByRow.get(source.id)], operation: 'translate_existing_pdf',
    })
  }
  return { coverage, jobs, translationJobs, existingSentences,
    unlinkedTranslations: missingTranslations.size - translationJobs.size }
}
