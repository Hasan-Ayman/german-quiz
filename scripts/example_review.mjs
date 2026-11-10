import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { exampleQueue, readJson } from './example_queue.mjs'
import { checkExample } from './validate_example.mjs'

const reviewCriteria = ['germanGrammar', 'naturalness', 'cefr', 'arabicAccuracy', 'semanticFit']
const statuses = ['human_approved', 'automated_checked', 'needs_manual_review', 'rejected']
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const stateFile = (dir, batch) => join(dir, batch + '.json')
const loadBatch = (dir, batch) => existsSync(stateFile(dir, batch)) ? readJson(stateFile(dir, batch)) : { records: [], errors: [] }

export function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = path + '.' + randomUUID() + '.tmp'
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

function withLock(dir, work) {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'workflow.lock')
  let fd
  try {
    fd = openSync(path, 'wx')
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const pid = Number(readFileSync(path, 'utf8'))
    if (Number.isSafeInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0)
      } catch (probe) {
        if (probe.code === 'ESRCH') {
          rmSync(path)
          return withLock(dir, work)
        }
        throw probe
      }
    }
    throw new Error('The example workflow is locked. Check that no other command is running.')
  }
  try {
    writeFileSync(fd, String(process.pid))
    return work()
  } finally {
    closeSync(fd)
    rmSync(path)
  }
}

function jobMetadata(job) {
  return {
    id: job.id, level: job.level, german: job.entry.german, article: job.entry.article,
    arabic: job.entry.arabic_translations, part_of_speech: job.entry.part_of_speech,
    sources: job.sources.map(row => ({
      id: row.id, pdf: row.source_pdf, page: row.source_page, chapter: row.chapter_number,
      box: row.source_bbox, fingerprint: row.review_fingerprint,
    })),
    original_candidates: job.pdf.map(({ source_id, german, association_check }) =>
      ({ source_id, german, association_check })),
  }
}

export function makePlan(queue, pilotIds) {
  if (pilotIds.length < 30 || pilotIds.length > 50 || new Set(pilotIds).size !== pilotIds.length ||
      pilotIds.some(id => !queue.jobs.has(id))) throw new Error('Choose 30–50 distinct eligible pilot IDs.')
  const pilot = new Set(pilotIds)
  const ordered = [...queue.jobs.values()].filter(job => !pilot.has(job.id))
    .sort((a, b) => Number(!a.pdf.length) - Number(!b.pdf.length) ||
      a.level.localeCompare(b.level) || a.id.localeCompare(b.id))
  const batches = { pilot: pilotIds }
  for (let index = 0; index < ordered.length; index += 100) {
    batches['batch-' + String(index / 100 + 1).padStart(3, '0')] = ordered.slice(index, index + 100).map(job => job.id)
  }
  const jobs = Object.fromEntries([...queue.jobs.values()].map(job => [job.id, jobMetadata(job)]))
  return { version: 1, baseline: queue.coverage, batches, snapshot: hash(jobs), jobs }
}

function recordFrom(draft, job, audit, history = [], spelling = null) {
  const { entryId, sourceId, level, origin, german, arabic, arabicOrigin = null,
    sourceAssociation = null, editorialNote = '' } = draft
  const content = { entryId, sourceId, level, origin, german, arabic, arabicOrigin, sourceAssociation, editorialNote }
  const validation = checkExample(content, job, audit, spelling)
  const source = job.sources.find(row => row.id === sourceId)
  const fingerprint = hash([content, source?.review_fingerprint, history.length])
  return { ...content, fingerprint, status: validation.status, validation, history }
}

function errorRecord(index, id, reason) {
  return { index, entryId: typeof id === 'string' ? id : null, reason }
}

export function checkpointDrafts(dir, batch, ids, drafts, queue, audit, spelling = null) {
  const state = loadBatch(dir, batch)
  const records = new Map(state.records.map(record => [record.entryId, record]))
  const seen = new Set()
  const errors = []
  for (const [index, draft] of drafts.entries()) {
    const id = draft?.entryId
    if (!ids.includes(id) || seen.has(id)) {
      errors.push(errorRecord(index, id, seen.has(id) ? 'duplicate_input' : 'id_outside_batch'))
      continue
    }
    seen.add(id)
    const current = records.get(id)
    const next = recordFrom(draft, queue.jobs.get(id), audit, [], spelling)
    if (current) {
      if (current.fingerprint !== next.fingerprint) errors.push(errorRecord(index, id, 'already_checkpointed_use_review_edit'))
      else if (!current.history.length && next.validation.spelling) records.set(id, next)
      continue
    }
    records.set(id, next)
  }
  const checkpoint = { records: ids.filter(id => records.has(id)).map(id => records.get(id)), errors }
  writeJsonAtomic(stateFile(dir, batch), checkpoint)
  return checkpoint
}

export function applyDecisions(state, decisions, queue, audit) {
  const records = new Map(state.records.map(record => [record.entryId, record]))
  const errors = []
  const used = new Set()
  for (const [index, item] of decisions.entries()) {
    if (!item?.decision) continue
    const { entryId, fingerprint, decision, reviewer, reason } = item
    const current = records.get(entryId)
    const job = queue.jobs.get(entryId)
    if (used.has(entryId) || !current || current.fingerprint !== fingerprint || !job ||
        typeof reviewer !== 'string' || !reviewer.trim() || typeof reason !== 'string' || !reason.trim()) {
      errors.push(errorRecord(index, entryId, 'duplicate_stale_or_unsigned_decision'))
      continue
    }
    used.add(entryId)
    if (current.history.some(event => event.fingerprint === fingerprint && event.decision === decision &&
      event.reviewer === reviewer && event.reason === reason)) continue
    if (current.status === 'human_approved') {
      errors.push(errorRecord(index, entryId, 'approved_record_is_immutable'))
      continue
    }
    const event = { decision, reviewer, reason, fingerprint }
    if (decision === 'edit') {
      const german = item.editedGerman ?? current.german
      const arabic = item.removeArabic === true ? null : item.editedArabic ?? current.arabic
      if (current.origin === 'source_pdf' && german !== current.german) {
        errors.push(errorRecord(index, entryId, 'pdf_german_is_immutable'))
        continue
      }
      records.set(entryId, recordFrom({ ...current, german, arabic, arabicOrigin: arabic === null ? null : 'authored' },
        job, audit, [...current.history, { ...event, previousGerman: current.german, previousArabic: current.arabic }]))
      continue
    }
    const flags = current.validation.flags
    if (decision === 'approve' && current.status !== 'rejected' && !current.validation.errors.length &&
        reviewCriteria.every(key => item.checks?.[key] === true) &&
        (!flags.includes('pdf_association_needs_visual_review') || item.checkedPdf === true) &&
        (!flags.includes('review_original_before_authored_fallback') || item.checkedPdf === true)) {
      records.set(entryId, { ...current, status: 'human_approved', history: [...current.history, {
        ...event, checks: Object.fromEntries(reviewCriteria.map(key => [key, true])), checkedPdf: item.checkedPdf === true,
      }] })
    } else if (decision === 'reject') {
      records.set(entryId, { ...current, status: 'rejected', history: [...current.history, event] })
    } else {
      errors.push(errorRecord(index, entryId, 'decision_conflicts_with_validation'))
    }
  }
  return { records: [...records.values()], errors }
}

export function approvedSupplement(records, queue) {
  return records.filter(record => record.status === 'human_approved' &&
    record.history.at(-1)?.decision === 'approve').map(record => {
    const source = queue.jobs.get(record.entryId).sources.find(row => row.id === record.sourceId)
    return {
      entryId: record.entryId, level: record.level, origin: record.origin, german: record.german,
      arabic: record.arabic, arabicOrigin: record.arabicOrigin, status: record.status,
      sourceId: source.id, sourcePdf: source.source_pdf, chapter: source.chapter_number, page: source.source_page,
      decision: record.history.at(-1),
    }
  })
}

function reviewRows(state, plan) {
  return state.records.map(record => {
    const job = plan.jobs[record.entryId]
    const source = job.sources.find(item => item.id === record.sourceId)
    return {
      entryId: record.entryId, fingerprint: record.fingerprint, level: job.level, target: job.german,
      originalArabic: job.arabic, source, origin: record.origin, german: record.german, arabic: record.arabic,
      arabicOrigin: record.arabicOrigin, status: record.status, confidence: record.validation.confidence,
      targetEvidence: record.validation.evidence, flags: [...record.validation.errors, ...record.validation.flags],
      notes: record.validation.notes, spelling: record.validation.spelling, editorialNote: record.editorialNote,
      decision: null, reviewer: '', reason: '', editedGerman: null, editedArabic: null, removeArabic: false,
      checkedPdf: false, checks: Object.fromEntries(reviewCriteria.map(key => [key, false])),
    }
  })
}

function emitReports(dir, batch, plan, state) {
  const rows = reviewRows(state, plan)
  // Keep the editable sheet separate from checkpoints. Regeneration writes a
  // fresh template and never overwrites a user's separate decisions file.
  writeJsonAtomic(join(dir, batch + '-review-template.json'), rows)
  const counts = Object.fromEntries(statuses
    .map(status => [status, state.records.filter(record => record.status === status).length]))
  writeJsonAtomic(join(dir, batch + '-validation.json'), {
    baseline: plan.baseline, batch, planned: plan.batches[batch].length, checkpointed: rows.length, counts,
    recovered_pdf_with_visual_comparison: state.records.filter(record =>
      record.origin === 'source_pdf' && record.sourceAssociation === 'ai_visual_checked' &&
      !record.validation.errors.length).length,
    authored_proposals: rows.filter(row => row.origin === 'authored').length, errors: state.errors,
    limitation: 'Target matching and layout checks do not establish grammar, CEFR suitability, or translation equivalence.',
    review: rows,
  })
}

function run() {
  const args = parseArgs({ allowPositionals: true, options: {
    root: { type: 'string' }, state: { type: 'string' }, audit: { type: 'string' }, supplement: { type: 'string' },
    spelling: { type: 'string' }, level: { type: 'string' }, status: { type: 'string' }, output: { type: 'string' },
  } })
  const [command, batch, input] = args.positionals
  const root = resolve(args.values.root ?? fileURLToPath(new URL('..', import.meta.url)))
  const dir = resolve(args.values.state ?? join(root, 'reports', 'phase35'))
  const audit = () => readJson(resolve(args.values.audit ?? join(root, 'reports', 'phase35-source-audit.json')))
  const queue = exampleQueue(root)
  const planPath = join(dir, 'plan.json')
  withLock(dir, () => {
    if (command === 'plan') {
      const next = makePlan(queue, readJson(batch).map(item => item.entryId))
      if (existsSync(planPath) && hash(readJson(planPath)) !== hash(next)) throw new Error('The saved plan differs.')
      writeJsonAtomic(planPath, next)
      console.log(`Planned ${Object.keys(next.jobs).length} level-aware jobs. Later batches are locked.`)
      return
    }
    const plan = readJson(planPath)
    if (hash(makePlan(queue, plan.batches.pilot)) !== hash(plan)) throw new Error('The vocabulary snapshot changed.')
    const approvalPath = join(dir, 'method-approval.json')
    if (command === 'approve-method') {
      if (!batch?.trim() || !input?.trim()) throw new Error('Supply the human reviewer and approval reason.')
      if (loadBatch(dir, 'pilot').records.length !== plan.batches.pilot.length) {
        throw new Error('Complete the pilot before approving the method.')
      }
      writeJsonAtomic(approvalPath, { reviewer: batch, reason: input, plan: hash(plan) })
      return
    }
    if (!Object.hasOwn(plan.batches, batch)) throw new Error('Unknown batch.')
    if (batch !== 'pilot' && (!existsSync(approvalPath) || readJson(approvalPath).plan !== hash(plan))) {
      throw new Error('Later batches require explicit pilot method approval.')
    }
    let state = loadBatch(dir, batch)
    if (command === 'prepare' || command === 'export') {
      const { level, status, output } = args.values
      if ((level && !['A1', 'A2'].includes(level)) || (status && !statuses.includes(status))) {
        throw new Error('Unknown level or review status.')
      }
      const done = new Set(state.records.map(record => record.entryId))
      const rows = command === 'export'
        ? reviewRows(state, plan).filter(row => (!level || row.level === level) && (!status || row.status === status))
        : plan.batches[batch].filter(id => !done.has(id) && (!level || plan.jobs[id].level === level)).map(id => {
          const job = queue.jobs.get(id)
          return {
            ...plan.jobs[id], priority: job.pdf.length ? 'compare_printed_example_first' : 'author_example',
            source_forms: job.sources.map(row => ({
              sourceId: row.id, plural: row.plural, preterite: row.preterite, perfect: row.perfect,
              comparative: row.comparative, superlative: row.superlative,
            })),
          }
        })
      if (output) writeJsonAtomic(resolve(output), rows)
      else console.log(JSON.stringify(rows, null, 2))
      return
    }
    if (command === 'validate') {
      state = checkpointDrafts(dir, batch, plan.batches[batch], readJson(input), queue, audit(),
        args.values.spelling ? readJson(args.values.spelling) : null)
    } else if (command === 'review') {
      state = applyDecisions(state, readJson(input), queue, audit())
      writeJsonAtomic(stateFile(dir, batch), state)
      const approved = approvedSupplement(Object.keys(plan.batches)
        .flatMap(key => loadBatch(dir, key).records), queue)
      writeJsonAtomic(resolve(args.values.supplement ?? join(root, 'data', 'phase35-local-approved-examples.json')), approved)
    } else if (command !== 'report') {
      throw new Error('Use plan, prepare, validate, review, report, export or approve-method.')
    }
    emitReports(dir, batch, plan, state)
    console.log(`${batch}: ${state.records.length}/${plan.batches[batch].length} checkpointed, ${state.errors.length} input or decision errors.`)
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run()
