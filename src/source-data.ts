import { isLevel, type Level } from './pilot.ts'
import { readSourceExample, type SourceExample } from './example-data.ts'

export const sourceParts = ['noun', 'verb', 'adjective', 'adverb'] as const
export type SourcePart = typeof sourceParts[number]
export type ChapterKey = `${Level}:${number}`
export const pronouns = ['ich', 'du', 'er/sie/es', 'wir', 'ihr', 'sie/Sie'] as const
export const sourceFields = ['article', 'article_note', 'plural', 'preterite', 'perfect', 'comparative',
  'superlative', 'adverb_type', 'example_sentence'] as const
export const derivedFields = ['auxiliary', 'participle', 'conjugation_class', 'regularity',
  'prefix_class', 'reflexivity', 'function_class'] as const
type Field = typeof sourceFields[number]

export interface DerivedField {
  value: string
  method: string
  reference: string
  origin: 'derived_from_pdf' | 'external_reference'
  status: 'verified'
}

export interface SourceRow extends Record<Field, string | null> {
  id: string
  level: Level
  part_of_speech: SourcePart
  chapter_number: number
  chapter_title: string
  source_pdf: string
  source_page: number
  source_row: number
  source_bbox: number[]
  german: string | null
  arabic_translations: string[] | null
  synonyms: string[] | null
  antonyms: string[] | null
  raw_cells: string[]
  raw_arabic_glyph_lines: string[][]
  arabic_logical_lines: string[]
  raw_example_band: string | null
  extraction_flags: string[]
  validation_issues: string[]
  review_fingerprint: string
  combined_id: string
  verification_status: 'automated_pass' | 'manually_verified' | 'needs_manual_review'
  plural_marker: 'present' | 'dash' | 'blank' | 'unparsed' | null
  gradation_marker: 'present' | 'dash' | 'explicit_non_comparable' | 'blank' | 'unparsed' | null
  examples?: SourceExample[]
  derived: Record<typeof derivedFields[number], DerivedField | null> & {
    present: Record<typeof pronouns[number], DerivedField> | null
  }
}

function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid source data object')
  return input as Record<string, unknown>
}

const text = (value: unknown, max = 3000): value is string =>
  typeof value === 'string' && value.length <= max && !value.includes('\u0000')
const nullable = (value: unknown) => value === null || text(value)
const strings = (value: unknown) => Array.isArray(value) && value.length <= 50 && value.every(item => text(item))
const rawStrings = (value: unknown, max: number) => Array.isArray(value) &&
  value.length <= max && value.every(item => typeof item === 'string' && item.length <= 3000)
const positive = (value: unknown, max: number) => Number.isInteger(value) && Number(value) > 0 && Number(value) <= max

function checkedDerived(input: unknown): DerivedField | null {
  if (input === null) return null
  const field = object(input)
  if (!text(field.value, 300) || !field.value || !text(field.method, 300) || !field.method ||
      !text(field.reference, 500) || !field.reference || field.status !== 'verified' ||
      (field.origin !== 'derived_from_pdf' && field.origin !== 'external_reference')) throw new Error('Invalid derived field')
  return field as unknown as DerivedField
}

export function readSourceRows(input: unknown): SourceRow[] {
  if (!Array.isArray(input) || !input.length || input.length > 2500) throw new Error('Invalid source inventory')
  const ids = new Set<string>()
  return input.map((value, index) => {
    const row = object(value)
    const part = row.part_of_speech as SourcePart
    if (!isLevel(row.level) || !sourceParts.includes(part) || !positive(row.chapter_number, 12) ||
        !positive(row.source_page, row.level === 'A1' ? 62 : 50) || !positive(row.source_row, 99) ||
        row.source_pdf !== row.level + '.pdf' || !text(row.chapter_title, 300) ||
        row.id !== [row.level.toLowerCase(), String(row.chapter_number).padStart(2, '0'), part,
          String(row.source_row).padStart(2, '0')].join('-') || ids.has(row.id as string) ||
        !Array.isArray(row.source_bbox) || row.source_bbox.length !== 4 ||
        !row.source_bbox.every(n => typeof n === 'number' && Number.isFinite(n)) ||
        typeof row.review_fingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(row.review_fingerprint) ||
        typeof row.combined_id !== 'string' || !/^vocab-[a-f0-9]{24}$/u.test(row.combined_id) ||
        !['automated_pass', 'manually_verified', 'needs_manual_review'].includes(String(row.verification_status)) ||
        !sourceFields.every(field => nullable(row[field])) || !nullable(row.german) || !nullable(row.raw_example_band) ||
        !['arabic_translations', 'synonyms', 'antonyms'].every(field => row[field] === null || strings(row[field])) ||
        !Array.isArray(row.raw_arabic_glyph_lines) || row.raw_arabic_glyph_lines.length > 50 ||
        !row.raw_arabic_glyph_lines.every(line => rawStrings(line, 500)) ||
        !rawStrings(row.raw_cells, 50) || !rawStrings(row.arabic_logical_lines, 50) ||
        !['extraction_flags', 'validation_issues']
          .every(field => strings(row[field])) || (row.plural_marker !== null && !['present', 'dash', 'blank', 'unparsed'].includes(String(row.plural_marker))) ||
        (row.gradation_marker !== null && !['present', 'dash', 'blank', 'unparsed', 'explicit_non_comparable'].includes(String(row.gradation_marker)))) {
      throw new Error('Invalid source row ' + (index + 1))
    }
    const derived = object(row.derived)
    const enums: Partial<Record<typeof derivedFields[number], string[]>> = {
      auxiliary: ['haben', 'sein'], conjugation_class: ['regelmäßig', 'stark', 'gemischt'],
      regularity: ['regelmäßig', 'unregelmäßig'], prefix_class: ['trennbar', 'untrennbar'],
      reflexivity: ['reflexiv', 'ohne sich im Eintrag'], function_class: ['Hilfsverb', 'Modalverb'],
    }
    const scope = row.source_pdf + ' p. ' + row.source_page + ' row ' + row.id
    derivedFields.forEach(name => {
      const field = checkedDerived(derived[name])
      if (!field) return
      if (part !== 'verb' || row.verification_status === 'needs_manual_review' ||
          (enums[name] && !enums[name]!.includes(field.value)) ||
          (field.origin === 'derived_from_pdf' && field.reference !== scope) ||
          (field.origin === 'external_reference' && !/^https:\/\/(?:grammis\.ids-mannheim\.de|www\.duden\.de)\//u.test(field.reference)) ||
          (name === 'participle' && !(row.perfect as string | null)?.split(' ').includes(field.value))) {
        throw new Error('Derived value does not match its source')
      }
      if (name === 'auxiliary') {
        const finite = (row.perfect as string | null)?.match(/^(?:es )?(hat|haben|ist|sind) /u)?.[1]
        if (!finite || field.value !== (finite === 'hat' || finite === 'haben' ? 'haben' : 'sein')) {
          throw new Error('Derived auxiliary does not match printed Perfekt')
        }
      }
    })
    if (derived.present !== null) {
      if (part !== 'verb' || row.verification_status === 'needs_manual_review') throw new Error('Unexpected present paradigm')
      const present = object(derived.present)
      pronouns.forEach(pronoun => {
        const form = checkedDerived(present[pronoun])
        if (!form || form.origin !== 'external_reference' || !/^https:\/\/grammis\.ids-mannheim\.de\//u.test(form.reference) ||
            !/^[\p{L}]+$/u.test(form.value)) throw new Error('Invalid present paradigm')
      })
    }
    ids.add(row.id as string)
    if (row.examples === undefined) return row as unknown as SourceRow
    if (!Array.isArray(row.examples) || row.examples.length > 30) throw new Error('Invalid example archive')
    const examples = row.examples.map(readSourceExample)
    const originals = examples.filter(example => example.source_type === 'source_pdf')
    if (originals.length !== (row.example_sentence ? 1 : 0) ||
        examples.some(example => example.source_row_id !== row.id || example.level !== row.level) ||
        originals.some(example => example.source_page !== row.source_page || example.german !== row.example_sentence)) {
      throw new Error('Source example archive does not match the printed row')
    }
    return { ...row, examples } as unknown as SourceRow
  })
}
