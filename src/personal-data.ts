import { articles, automaticExampleApproval, isLevel, levels,
  type ExampleSentence, type Level, type PilotEntry } from './pilot.ts'

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
}

export interface PersonalEntry extends PilotEntry {
  sources: SourceReference[]
  vocabularyStatus: 'reviewed' | 'automatically_validated'
}

export interface PersonalDataset {
  format: typeof datasetFormat
  version: typeof datasetVersion
  entries: PersonalEntry[]
  distractorGroups: string[][]
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
  const { id, level, sourcePdf, chapter, page, chapterTitle, verificationStatus, approvalStatus, reviewMethod } = object(value)
  if (!isLevel(level) || sourcePdf !== level + '.pdf' ||
      !positive(chapter, 999) || !positive(page, 10_000) ||
      typeof id !== 'string' || !/^[a-z0-9-]{1,90}$/u.test(id) ||
      !id.startsWith(level.toLowerCase() + '-' + String(chapter).padStart(2, '0') + '-') ||
      (chapterTitle !== undefined && !safeText(chapterTitle, 300)) ||
      (verificationStatus !== 'manually_verified' && verificationStatus !== 'automated_pass') ||
      (approvalStatus !== undefined && approvalStatus !== 'approved' && approvalStatus !== 'pending_review') ||
      (reviewMethod != null && reviewMethod !== 'ai_pdf_visual' && reviewMethod !== 'user_approval_after_pdf_match')) {
    throw new Error('Invalid source reference')
  }
  return { id, level, sourcePdf, chapter: chapter as number, page: page as number, verificationStatus,
    ...(chapterTitle === undefined ? {} : { chapterTitle: chapterTitle as string }),
    ...(approvalStatus === undefined ? {} : { approvalStatus }),
    ...(reviewMethod === undefined ? {} : { reviewMethod }),
  }
}

function readExample(value: unknown, id: string, sources: SourceReference[]): ExampleSentence {
  const example = object(value)
  const { entryId, level, german, arabic, origin, verificationStatus, sourcePdf, chapter, page,
    localApproval: approval, arabicOrigin, arabicLocalApproval } = example
  if (entryId !== id || !isLevel(level) || !sources.some(source => source.level === level) ||
      !germanText(german, 2000) || !(arabic === null || arabicText(arabic, 3000)) || !localApproval(approval) ||
      (approval && !arabic)) throw new Error('Invalid example')
  const common: Pick<ExampleSentence, 'entryId' | 'level' | 'german' | 'arabic' | 'localApproval'> = {
    entryId: id, level, german: german as string, arabic: arabic as string | null,
    ...(approval ? { localApproval: automaticExampleApproval } : {}) }
  if (origin === 'source_pdf') {
    if ((verificationStatus !== 'manually_verified' && verificationStatus !== 'automated_checked') ||
        sourcePdf !== level + '.pdf' || !positive(chapter, 999) || !positive(page, 10_000) ||
        !localApproval(arabicLocalApproval) || (arabicOrigin !== undefined && (arabicOrigin !== 'authored' || !arabic)) ||
        (arabicLocalApproval && arabicOrigin !== 'authored') ||
        (approval && verificationStatus !== 'automated_checked')) throw new Error('Invalid PDF example provenance')
    return { ...common, origin, verificationStatus, sourcePdf: sourcePdf as string, chapter: chapter as number,
      page: page as number, ...(arabicOrigin ? { arabicOrigin } : {}),
      ...(arabicLocalApproval ? { arabicLocalApproval: automaticExampleApproval } : {}) }
  }
  if (origin !== 'authored' ||
      (verificationStatus !== 'reviewed' && verificationStatus !== automaticExampleApproval) || !arabic ||
      Boolean(approval) !== (verificationStatus === automaticExampleApproval)) throw new Error('Invalid authored example approval')
  return { ...common, origin, verificationStatus }
}

function readEntry(value: unknown): PersonalEntry {
  const row = object(value)
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
  const incomplete = levels.filter(level => (level === 'A2' || sourceLevels.includes(level)) &&
    !examples.some(example => level === 'A2' || example.level === 'A1'))
  const quiz = object(row.quiz)
  const { german_to_arabic, verb_translation, adjective_translation } = quiz
  const prompts = list(quiz.arabic_to_german_prompts, 30)
  if (typeof german_to_arabic !== 'boolean' || typeof verb_translation !== 'boolean' ||
      typeof adjective_translation !== 'boolean' || typeof quiz.article !== 'boolean' ||
      !prompts.every(prompt => glosses.includes(prompt)) ||
      (quiz.article && !article) || (verb_translation && (!german_to_arabic || part !== 'verb')) ||
      (adjective_translation && (!german_to_arabic || part !== 'adjective')) ||
      !(german_to_arabic || prompts.length || quiz.article)) throw new Error('Invalid quiz eligibility')
  return {
    id, german: german as string, article: article as PilotEntry['article'], part_of_speech: part as PilotEntry['part_of_speech'],
    arabic_translations: glosses as string[], synonyms: synonyms as string[], levels: sourceLevels,
    examples, incompleteExampleLevels: incomplete, sources, vocabularyStatus,
    quiz: { german_to_arabic, arabic_to_german_prompts: prompts as string[], article: quiz.article,
      verb_translation, adjective_translation },
  }
}

export function validatePersonalDataset(input: unknown): PersonalDataset {
  const { format, version, entries: raw, distractorGroups: rawGroups } = object(input)
  if (format !== datasetFormat || version !== datasetVersion) throw new Error('Unsupported vocabulary format or version')
  const rows = list(raw, 2500)
  if (!rows.length) throw new Error('The vocabulary file is empty')
  const ids = new Set<string>()
  const entries = rows.map((row, index) => {
    try {
      const entry = readEntry(row)
      if (ids.has(entry.id)) throw new Error('Duplicate entry ID')
      ids.add(entry.id)
      return entry
    } catch (error) {
      throw new Error('Invalid vocabulary entry ' + (index + 1), { cause: error })
    }
  })
  const distractorGroups = list(rawGroups, 100).map(value => {
    const group = list(value, 30)
    if (group.length < 2 || !group.every(word => germanText(word, 300))) throw new Error('Invalid distractor group')
    return group as string[]
  })
  return { format, version, entries, distractorGroups }
}

export async function readPersonalFile(file: Pick<File, 'size' | 'text'>) {
  if (!file.size || file.size > maximumDatasetBytes) throw new Error('Invalid vocabulary file size')
  return validatePersonalDataset(JSON.parse((await file.text()).replace(/^\uFEFF/u, '')))
}

export function serializePersonalDataset(dataset: PersonalDataset) {
  return JSON.stringify(dataset) + '\n'
}
