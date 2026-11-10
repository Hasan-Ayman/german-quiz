import { createHash } from 'node:crypto'
import { automaticExampleApproval } from '../src/pilot.ts'
import { checkExample } from './validate_example.mjs'

export const languageChecks = ['germanGrammar', 'naturalness', 'targetUsage', 'semanticFit', 'arabicAccuracy', 'cefr']
export const evidenceFingerprint = draft => createHash('sha256')
  .update(JSON.stringify([draft.entryId, draft.sourceId, draft.level, draft.origin, draft.german, draft.arabic]))
  .digest('hex')

export function evaluateForLocalUse(draft, job, audit, spelling, evidence) {
  const originalReview = evidence?.originalReview
  const reviewedOriginals = draft.origin === 'authored' && job?.pdf.length && Array.isArray(originalReview) &&
    job.pdf.every(example => originalReview.some(review => review.sourceId === example.source_id && review.reason?.trim()))
  const validation = checkExample(draft, reviewedOriginals ? { ...job, pdf: [] } : job, audit, spelling)
  const fingerprint = evidenceFingerprint(draft)
  const failed = evidence?.fingerprint === fingerprint && typeof evidence.method === 'string' && evidence.method.trim()
    ? languageChecks.filter(check => evidence.checks?.[check] !== true) : languageChecks
  const issues = [...validation.errors, ...validation.flags, ...failed]
  if (!draft.arabic) issues.push('missing_complete_arabic_sentence')
  if (issues.length) return {
    entryId: draft.entryId, sourceId: draft.sourceId, origin: draft.origin, status: 'needs_manual_review',
    validation, failedChecks: [...new Set(issues)], issue: evidence?.issue ?? null,
  }
  const source = job.sources.find(row => row.id === draft.sourceId)
  return {
    entryId: draft.entryId, level: draft.level, origin: draft.origin, german: draft.german, arabic: draft.arabic,
    arabicOrigin: draft.arabicOrigin, status: automaticExampleApproval,
    sourceId: source.id, sourcePdf: source.source_pdf, chapter: source.chapter_number, page: source.source_page,
    ...(job.operation ? { operation: job.operation } : {}),
    validation, sourceAssociation: draft.sourceAssociation ?? null, sourceFingerprint: source.review_fingerprint,
    ...(reviewedOriginals ? { originalReview } : {}),
    decision: {
      decision: 'approve_local_automated', method: evidence.method, fingerprint,
      checks: { ...Object.fromEntries(languageChecks.map(check => [check, true])), structure: true },
    },
  }
}
