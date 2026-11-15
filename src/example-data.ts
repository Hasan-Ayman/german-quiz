import { isLevel, type ExampleMetadata, type Level } from './pilot.ts'

export interface SourceExample extends ExampleMetadata {
  german: string
  arabic: string | null
  level: Level
}

export function readExampleMetadata(value: Record<string, unknown>): ExampleMetadata | undefined {
  if (value.source_type === undefined) return
  const { source_type, grammar_focus, verification_status, source_page, source_row_id, example_review } = value
  if ((source_type !== 'source_pdf' && source_type !== 'generated') ||
      typeof grammar_focus !== 'string' || !grammar_focus.trim() || grammar_focus.length > 200 ||
      (verification_status !== 'language_checked' && verification_status !== 'previously_reviewed' && verification_status !== 'needs_review') ||
      typeof source_row_id !== 'string' || !/^a[12]-\d\d-(?:noun|verb|adjective|adverb)-\d\d$/u.test(source_row_id) ||
      (source_type === 'generated' ? source_page !== null : !Number.isInteger(source_page) || Number(source_page) < 1) ||
      (verification_status === 'needs_review' ? value.arabic !== null || source_type !== 'source_pdf'
        : typeof value.arabic !== 'string' || !/\p{Script=Arabic}/u.test(value.arabic))) {
    throw new Error('Invalid example origin, status or translation')
  }
  let review: ExampleMetadata['example_review']
  if (verification_status !== 'needs_review') {
    const record = example_review as Partial<NonNullable<ExampleMetadata['example_review']>> | null
    if (!record || typeof record.method !== 'string' || !record.method.trim() || record.method.length > 160 ||
        typeof record.evidence !== 'string' || !/^[a-f0-9]{64}$/u.test(record.evidence)) throw new Error('Missing example review evidence')
    review = { method: record.method, evidence: record.evidence }
  }
  return { source_type, grammar_focus, verification_status, source_page: source_page as number | null,
    source_row_id, ...(review ? { example_review: review } : {}) }
}

export function readSourceExample(value: unknown): SourceExample {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid archived example')
  const candidate = value as Record<string, unknown>
  const info = readExampleMetadata(candidate)
  const { german, arabic, level } = candidate
  if (!info || !isLevel(level) || typeof german !== 'string' || !german.trim() || german.length > 2000 ||
      /[\p{Script=Arabic}\u0000]/u.test(german) ||
      !(arabic === null || (typeof arabic === 'string' && arabic.length <= 3000 && /\p{Script=Arabic}/u.test(arabic) &&
        !/[\p{C}\uFFFD]/u.test(arabic)))) throw new Error('Invalid archived example text')
  return { ...info, german, arabic, level } as SourceExample
}
