import { articles, automaticExampleApproval, isLevel, levels,
  type ExampleSentence, type Level, type PilotEntry } from './pilot.ts'
import { readSourceRows, bookFilenames, type SourceRow } from './source-data.ts'
import { readExampleMetadata } from './example-data.ts'
import { ImportProblem, requireImportFields } from './import-problem.ts'
import { grammarTypes } from './question-types.ts'

export const datasetFormat = 'german-quiz-personal'
export const datasetVersion = 1
export const maximumDatasetBytes = 12 * 1024 * 1024

interface SourceReference {
  id: string
  level: Level
  sourcePdf: string
  chapter: number
  page: number
  chapterTitle?: string
  verificationStatus: 'manually_verified' | 'automated_pass'
  approvalStatus?: 'approved' | 'pending_review'
  reviewMethod?: 'ai_pdf_visual' | 'user_approval_after_pdf_match' | null
  document?: 'a1-book' | 'a2-book'
}

export interface PersonalEntry extends PilotEntry {
  sources: SourceReference[]
  vocabularyStatus: 'reviewed' | 'automatically_validated'
}

export interface PersonalDataset {
  format: typeof datasetFormat
  version: 1 | 2
  entries: PersonalEntry[]
  distractorGroups: string[][]
  sourceRows?: SourceRow[]
  questionExclusions?: { sourceRowId: string; mode: string; reason: string; method: 'ai_source_review' }[]
}

type RecordValue = Record<string, unknown>
const parts = ['noun', 'verb', 'adjective', 'adverb']
const safeText = (value: unknown, max: number) => typeof value === 'string' &&
  value.trim().length > 0 && value.length <= max && !/[\p{Cc}\uFFFD\u202A-\u202E\u2066-\u2069]/u.test(value)
const germanText = (value: unknown, max: number) =>
  safeText(value, max) && /\p{Script=Latin}/u.test(value as string) && !/\p{Script=Arabic}/u.test(value as string)
const arabicText = (value: unknown, max: number) =>
  safeText(value, max) && /\p{Script=Arabic}/u.test(value as string)
const positive = (value: unknown, max: number) => Number.isInteger(value) && Number(value) > 0 && Number(value) <= max
const localApproval = (value: unknown) => value === undefined || value === automaticExampleApproval

function object(value: unknown): RecordValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object')
  return value as RecordValue
}

function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('Invalid list')
  return value
}

function readSource(value: unknown): SourceReference {
  const source = object(value)
  requireImportFields(source, ['id', 'level', 'sourcePdf', 'chapter', 'page', 'verificationStatus'])
  const { id, level, sourcePdf, chapter, page, chapterTitle, verificationStatus, approvalStatus, reviewMethod } = source
  const book = source.document === String(level).toLowerCase() + '-book'
  if (!isLevel(level) || sourcePdf !== (book ? bookFilenames[level] : level + '.pdf') ||
      (source.document !== undefined && !book) ||
      !positive(chapter, 999) || !positive(page, 10_000) ||
      typeof id !== 'string' || !/^[a-z0-9-]{1,90}$/u.test(id) ||
      !id.startsWith(level.toLowerCase() + '-' + String(chapter).padStart(2, '0') + '-') ||
      (chapterTitle !== undefined && !safeText(chapterTitle, 300)) ||
      (verificationStatus !== 'manually_verified' && verificationStatus !== 'automated_pass') ||
      (approvalStatus !== undefined && approvalStatus !== 'approved' && approvalStatus !== 'pending_review') ||
      (reviewMethod != null && reviewMethod !== 'ai_pdf_visual' && reviewMethod !== 'user_approval_after_pdf_match')) {
    throw new Error('Invalid source reference')
  }
  return { ...source, id, level, sourcePdf, chapter: chapter as number, page: page as number, verificationStatus,
    ...(chapterTitle === undefined ? {} : { chapterTitle: chapterTitle as string }),
    ...(approvalStatus === undefined ? {} : { approvalStatus }),
    ...(reviewMethod === undefined ? {} : { reviewMethod }),
  }
}

function readExample(value: unknown, id: string, sources: SourceReference[]): ExampleSentence {
  const example = object(value)
  requireImportFields(example, ['entryId', 'level', 'german', 'arabic', 'origin', 'verificationStatus'])
  const metadata = readExampleMetadata(example)
  const { entryId, level, german, arabic, origin, verificationStatus, sourcePdf, chapter, page,
    localApproval: approval, arabicOrigin, arabicLocalApproval } = example
  if (entryId !== id || !isLevel(level) || !sources.some(source => source.level === level) ||
      !germanText(german, 2000) || !(arabic === null || arabicText(arabic, 3000)) || !localApproval(approval) ||
      (approval && !arabic)) throw new Error('Invalid example')
  if (metadata && (metadata.source_type !== (origin === 'source_pdf' ? 'source_pdf' : 'generated') ||
      !sources.some(source => source.id === metadata.source_row_id && source.level === level) ||
      (metadata.source_type === 'source_pdf' && metadata.source_page !== page))) throw new Error('Invalid example source link')
  const common: Pick<ExampleSentence, 'entryId' | 'level' | 'german' | 'arabic' | 'localApproval'> & RecordValue = {
    ...example, entryId: id, level, german: german as string, arabic: arabic as string | null,
    ...(approval ? { localApproval: automaticExampleApproval } : {}) }
  if (origin === 'source_pdf') {
    const proof=metadata?.textbook_source
    const textbook=Boolean(proof && proof.document===level.toLowerCase()+'-book' && sourcePdf===bookFilenames[level] &&
      sources.some(source=>source.id===metadata?.source_row_id&&source.document===proof.document) && chapter===proof.chapter)
    if ((verificationStatus !== 'manually_verified' && verificationStatus !== 'automated_checked') ||
        (!textbook && (proof || sourcePdf !== level + '.pdf' || !positive(chapter, 999))) || !positive(page, 10_000) ||
        (textbook && verificationStatus!=='automated_checked') ||
        !localApproval(arabicLocalApproval) || (arabicOrigin !== undefined && (arabicOrigin !== 'authored' || !arabic)) ||
        (arabicLocalApproval && arabicOrigin !== 'authored') ||
        (approval && verificationStatus !== 'automated_checked')) throw new Error('Invalid PDF example provenance')
    return { ...common, ...metadata, origin, verificationStatus, sourcePdf: sourcePdf as string, chapter: chapter as number|null,
      page: page as number, ...(arabicOrigin ? { arabicOrigin } : {}),
      ...(arabicLocalApproval ? { arabicLocalApproval: automaticExampleApproval } : {}) }
  }
  if (origin !== 'authored' ||
      (verificationStatus !== 'reviewed' && verificationStatus !== automaticExampleApproval) || !arabic ||
      Boolean(approval) !== (verificationStatus === automaticExampleApproval)) throw new Error('Invalid authored example approval')
  return { ...common, ...metadata, origin, verificationStatus }
}

function readEntry(value: unknown, allowGrammarOnly: boolean): PersonalEntry {
  const row = object(value)
  requireImportFields(row, ['id', 'german', 'article', 'part_of_speech', 'arabic_translations', 'synonyms',
    'sources', 'levels', 'examples', 'quiz', 'vocabularyStatus'])
  const { id, german, article, part_of_speech: part, vocabularyStatus } = row
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,95}$/u.test(id) || !germanText(german, 300) ||
      typeof part !== 'string' || !parts.includes(part) ||
      !(article === null || (part === 'noun' && articles.some(item => item === article))) ||
      (vocabularyStatus !== 'reviewed' && vocabularyStatus !== 'automatically_validated')) throw new Error('Invalid entry')
  const glosses = list(row.arabic_translations, 30)
  const synonyms = list(row.synonyms, 30)
  if (!glosses.length || !glosses.every(text => arabicText(text, 500)) ||
      !synonyms.every(text => germanText(text, 300))) throw new Error('Invalid translations or synonyms')
  const sources = list(row.sources, 30).map(readSource)
  if (!sources.length || new Set(sources.map(source => source.id)).size !== sources.length ||
      (vocabularyStatus === 'reviewed' && !sources.some(source => source.verificationStatus === 'manually_verified' ||
        (source.approvalStatus === 'approved' && source.reviewMethod)))) throw new Error('Invalid vocabulary approval')
  const sourceLevels = levels.filter(level => sources.some(source => source.level === level))
  if (!Array.isArray(row.levels) || row.levels.length !== sourceLevels.length ||
      sourceLevels.some(level => !(row.levels as unknown[]).includes(level))) throw new Error('Invalid source levels')
  const examples = list(row.examples, 30).map(example => readExample(example, id, sources))
  const bilingual = examples.some(example => example.source_type)
  const incomplete = levels.filter(level => (level === 'A2' || sourceLevels.includes(level)) &&
    !examples.some(example => (level === 'A2' || example.level === 'A1') && (!bilingual || example.arabic)))
  const quiz = object(row.quiz)
  requireImportFields(quiz, ['german_to_arabic', 'verb_translation', 'adjective_translation', 'article', 'arabic_to_german_prompts'])
  const { german_to_arabic, verb_translation, adjective_translation } = quiz
  const prompts = list(quiz.arabic_to_german_prompts, 30)
  if (typeof german_to_arabic !== 'boolean' || typeof verb_translation !== 'boolean' ||
      typeof adjective_translation !== 'boolean' || typeof quiz.article !== 'boolean' ||
      !prompts.every(prompt => glosses.includes(prompt)) ||
      (quiz.article && !article) || (verb_translation && (!german_to_arabic || part !== 'verb')) ||
      (adjective_translation && (!german_to_arabic || part !== 'adjective')) ||
      !(allowGrammarOnly || german_to_arabic || prompts.length || quiz.article)) throw new Error('Invalid quiz eligibility')
  return {
    ...row, id, german: german as string, article: article as PilotEntry['article'], part_of_speech: part as PilotEntry['part_of_speech'],
    arabic_translations: glosses as string[], synonyms: synonyms as string[], levels: sourceLevels,
    examples, incompleteExampleLevels: incomplete, sources, vocabularyStatus,
    quiz: { ...quiz, german_to_arabic, arabic_to_german_prompts: prompts as string[], article: quiz.article,
      verb_translation, adjective_translation },
  }
}

export function validatePersonalDataset(input: unknown): PersonalDataset {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ImportProblem('schema', 'Unsupported vocabulary format or version')
  }
  const record = object(input)
  const { format, version, entries: raw, distractorGroups: rawGroups, sourceRows: rawSources } = record
  if (format !== datasetFormat || (version !== datasetVersion && version !== 2)) {
    throw new ImportProblem('schema', 'Unsupported vocabulary format or version')
  }
  requireImportFields(record, version === 2 ? ['entries', 'distractorGroups', 'sourceRows'] : ['entries', 'distractorGroups'])
  const sourceRows = version === 2 ? readSourceRows(rawSources) : undefined
  const exampleArchive = sourceRows?.some(source => source.examples)
  if (exampleArchive && !sourceRows?.every(source => source.examples)) throw new ImportProblem('source', 'Incomplete example archive')
  const bySource = new Map(sourceRows?.map(source => [source.id, source]))
  if (!Array.isArray(raw) || !raw.length || raw.length > 2500) throw new ImportProblem('record', 'Invalid vocabulary entries')
  const rows: unknown[] = raw
  const ids = new Set<string>()
  const entries = rows.map((row, index) => {
    try {
      const entry = readEntry(row, version === 2)
      if (ids.has(entry.id)) throw new Error('Duplicate entry ID')
      if (sourceRows) {
        for (const ref of entry.sources) {
          const source = bySource.get(ref.id)
          if (!source || source.combined_id !== entry.id || source.verification_status === 'needs_manual_review' ||
              source.verification_status !== ref.verificationStatus || source.level !== ref.level ||
              source.source_pdf !== ref.sourcePdf || source.chapter_number !== ref.chapter || source.source_page !== ref.page ||
              source.source_document !== ref.document ||
              source.german !== entry.german || source.part_of_speech !== entry.part_of_speech || source.article !== entry.article ||
              [...(source.arabic_translations ?? [])].sort().join('\n') !== [...entry.arabic_translations].sort().join('\n') ||
              [...(source.synonyms ?? [])].sort().join('\n') !== [...entry.synonyms].sort().join('\n')) {
            throw new Error('Entry differs from its source row')
          }
        }
        if (exampleArchive) {
          const archived = entry.sources.flatMap(ref => bySource.get(ref.id)!.examples ?? [])
          const signature = (example: typeof archived[number] | ExampleSentence) =>
            JSON.stringify([example.german, example.arabic, example.level, example.source_type, example.grammar_focus,
              example.verification_status, example.source_page, example.source_row_id, example.example_review?.evidence,
              example.example_review?.method,example.textbook_source])
          if (JSON.stringify(archived.map(signature).sort()) !== JSON.stringify(entry.examples.map(signature).sort()) ||
              entry.examples.some(example => example.origin === 'source_pdf' && example.verificationStatus !==
                (bySource.get(example.source_row_id ?? '')?.verification_status === 'manually_verified'
                  ? 'manually_verified' : 'automated_checked'))) throw new Error('Examples differ from the reviewed archive')
        } else if (entry.examples.some(example => example.origin !== 'source_pdf' || example.arabic !== null ||
          example.localApproval || example.arabicOrigin || example.arabicLocalApproval || !entry.sources.some(ref => {
          const row = bySource.get(ref.id)!
          return row.level === example.level && row.source_page === example.page &&
            row.chapter_number === example.chapter && row.example_sentence === example.german &&
            example.verificationStatus === (row.verification_status === 'manually_verified' ? 'manually_verified' : 'automated_checked')
        }))) throw new Error('Example differs from its source row')
      }
      ids.add(entry.id)
      return entry
    } catch (error) {
      if (error instanceof ImportProblem && error.code === 'missing') {
        throw new ImportProblem('missing', error.message, error.field, index + 1, { cause: error })
      }
      throw new ImportProblem('record', 'Invalid vocabulary entry ' + (index + 1), undefined, index + 1, { cause: error })
    }
  })
  let distractorGroups: string[][]
  try {
    distractorGroups = list(rawGroups, 100).map(value => {
      const group = list(value, 30)
      if (group.length < 2 || !group.every(word => germanText(word, 300))) throw new Error('Invalid distractor group')
      return group as string[]
    })
  } catch (error) {
    throw new ImportProblem('record', 'Invalid distractor groups', undefined, undefined, { cause: error })
  }
  if (record.questionExclusions !== undefined) {
    const exclusions = list(record.questionExclusions, 4000).map(object)
    const keys = new Set<string>()
    for (const exclusion of exclusions) {
      const source = bySource?.get(String(exclusion.sourceRowId))
      const identity = String(exclusion.sourceRowId) + ':' + String(exclusion.mode)
      const scopedMode = typeof exclusion.mode==='string' && ((exclusion.mode.startsWith(source?.part_of_speech+'-') && Object.hasOwn(grammarTypes,exclusion.mode)) || exclusion.mode==='article'&&source?.part_of_speech==='noun')
      if (!source || !scopedMode ||
          !safeText(exclusion.reason, 500) || exclusion.method !== 'ai_source_review' || keys.has(identity)) {
        throw new ImportProblem('source', 'Invalid field-level question exclusion')
      }
      keys.add(identity)
    }
  }
  return { ...record, format, version, entries, distractorGroups, ...(sourceRows ? { sourceRows } : {}) }
}

export async function readPrivateJson(file: Pick<File, 'size' | 'text'> & Partial<Pick<File, 'arrayBuffer'>>, maximumBytes: number): Promise<unknown> {
  if (!file.size) throw new ImportProblem('empty', 'Empty private file')
  if (file.size > maximumBytes) throw new ImportProblem('size', 'Invalid private file size')
  let content: string | ArrayBuffer
  try {
    if (typeof file.arrayBuffer === 'function') content = await file.arrayBuffer()
    else if (typeof file.text === 'function') content = await file.text()
    else if (file instanceof Blob) {
      content = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.onerror = () => reject(reader.error)
        reader.onabort = () => reject(reader.error)
        reader.readAsArrayBuffer(file)
      })
    } else throw new Error('No file reader is available')
  } catch (error) {
    throw new ImportProblem('read', 'Cannot read file', undefined, undefined, { cause: error })
  }
  if (typeof content !== 'string') {
    const [first, second] = new Uint8Array(content, 0, Math.min(content.byteLength, 2))
    const encoding = first === 0xff && second === 0xfe ? 'utf-16le' : first === 0xfe && second === 0xff ? 'utf-16be' : 'utf-8'
    try {
      content = new TextDecoder(encoding, { fatal: true }).decode(content)
    } catch (error) {
      throw new ImportProblem('encoding', 'Invalid text encoding', undefined, undefined, { cause: error })
    }
  }
  try {
    return JSON.parse(content.replace(/^\uFEFF/u, ''))
  } catch (error) {
    throw new ImportProblem('syntax', 'Invalid JSON syntax', undefined, undefined, { cause: error })
  }
}

export async function readPersonalFile(file: Parameters<typeof readPrivateJson>[0]) {
  return validatePersonalDataset(await readPrivateJson(file, maximumDatasetBytes))
}

export function serializePersonalDataset(dataset: PersonalDataset) {
  return JSON.stringify(dataset) + '\n'
}
