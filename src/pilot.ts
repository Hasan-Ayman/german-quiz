export const articles = ['der', 'die', 'das'] as const
export type Article = (typeof articles)[number]
export type PartOfSpeech = 'noun' | 'verb' | 'adjective' | 'adverb'
export const levels = ['A1', 'A2'] as const
export type Level = (typeof levels)[number]
export const isLevel = (value: unknown): value is Level => value === 'A1' || value === 'A2'
export type Reliability = 'reviewed' | 'with-automatic'
export const isReliability = (value: unknown): value is Reliability =>
  value === 'reviewed' || value === 'with-automatic'

interface ExampleText {
  entryId: string
  german: string
  arabic: string | null
  level: Level
  localApproval?: typeof automaticExampleApproval
}

export const automaticExampleApproval = 'automated_approved_for_local_use'

interface PdfExample extends ExampleText {
  origin: 'source_pdf'
  sourcePdf: string
  chapter: number
  page: number
  verificationStatus: 'manually_verified' | 'automated_checked'
  arabicOrigin?: 'authored'
  arabicLocalApproval?: typeof automaticExampleApproval
}

interface AuthoredExample extends ExampleText {
  origin: 'authored'
  verificationStatus: 'reviewed' | 'needs_manual_review' | typeof automaticExampleApproval
}

export type ExampleSentence = PdfExample | AuthoredExample

export interface PilotEntry {
  id: string
  german: string
  article: Article | null
  part_of_speech: PartOfSpeech
  arabic_translations: string[]
  synonyms: string[]
  levels: Level[]
  examples: ExampleSentence[]
  incompleteExampleLevels: Level[]
  quiz: {
    german_to_arabic: boolean
    arabic_to_german_prompts: string[]
    article: boolean
    verb_translation: boolean
    adjective_translation: boolean
  }
}

const parts = new Set(['noun', 'verb', 'adjective', 'adverb'])
const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '' && !/[\p{Cc}\uFFFD]/u.test(value)
const isTextList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isText)

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function verifiedExample(source: Record<string, unknown>, entryId: string, local: boolean): PdfExample[] {
  const { level, source_pdf, chapter_number, source_page, example_sentence, example_arabic_translation } = source
  const prior = source.verification_status === 'manually_verified'
  const checked = local && source.example_approval === 'approved' && isLocallyReviewed(source)
  if (!(prior || checked) || !isText(example_sentence) ||
      !isLevel(level) || source_pdf !== level + '.pdf' ||
      typeof chapter_number !== 'number' || !Number.isInteger(chapter_number) || chapter_number < 1 ||
      typeof source_page !== 'number' || !Number.isInteger(source_page) || source_page < 1) return []

  return [{
    entryId, origin: 'source_pdf',
    german: example_sentence,
    arabic: isText(example_arabic_translation) && /\p{Script=Arabic}/u.test(example_arabic_translation)
      ? example_arabic_translation : null,
    level, sourcePdf: source_pdf, chapter: chapter_number, page: source_page,
    verificationStatus: prior ? 'manually_verified' : 'automated_checked',
  }]
}

export function preferredExample(examples: readonly ExampleSentence[], level: Level): ExampleSentence | undefined {
  const fits = (example: ExampleSentence) => level === 'A2' || example.level === 'A1'
  return examples.find(example =>
    example.origin === 'source_pdf' && fits(example)
  ) ?? examples.find(example =>
    example.origin === 'authored' &&
    (example.verificationStatus === 'reviewed' || example.verificationStatus === automaticExampleApproval) && fits(example)
  )
}

export function addApprovedLocalExamples(entries: PilotEntry[], input: unknown): PilotEntry[] {
  if (!Array.isArray(input)) throw new Error('The approved local example supplement must be an array.')
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  const additions = new Map<string, ExampleSentence[]>()
  const translations = new Map<PdfExample, { arabic: string; automatic: boolean }>()
  for (const value of input) {
    const row = asObject(value)
    const { entryId, level, german, arabic, arabicOrigin, origin, sourceId, sourcePdf, chapter, page } = row
    const decision = asObject(row.decision)
    const checks = asObject(decision.checks)
    const entry = isText(entryId) ? byId.get(entryId) : undefined
    const automatic = row.status === automaticExampleApproval
    const authorized = automatic
      ? decision.decision === 'approve_local_automated' && isText(decision.method) &&
        ['targetUsage', 'structure'].every(key => checks[key] === true)
      : row.status === 'human_approved' && decision.decision === 'approve' &&
        isText(decision.reviewer) && isText(decision.reason)
    if (!authorized || automatic && !isText(arabic) ||
        typeof decision.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(decision.fingerprint) ||
        !['germanGrammar', 'naturalness', 'cefr', 'arabicAccuracy', 'semanticFit'].every(key => checks[key] === true) ||
        !entry || !isLevel(level) || !entry.levels.includes(level) ||
        !isText(german) || !/\p{Script=Latin}/u.test(german) || /[\p{Script=Arabic}\p{C}]/u.test(german) ||
        !(isText(arabic) && /\p{Script=Arabic}/u.test(arabic) && !/[\p{Script=Latin}\p{C}]/u.test(arabic) &&
          arabicOrigin === 'authored' || arabic === null && arabicOrigin === null && origin === 'source_pdf') ||
        (origin !== 'authored' && origin !== 'source_pdf') ||
        typeof chapter !== 'number' || !Number.isInteger(chapter) || chapter < 1 ||
        typeof page !== 'number' || !Number.isInteger(page) || page < 1 ||
        sourcePdf !== level + '.pdf' || !isText(sourceId) ||
        !sourceId.startsWith(level.toLowerCase() + '-' + String(chapter).padStart(2, '0') + '-')) continue
    if (row.operation === 'translate_existing_pdf') {
      const match = entry.examples.find((example): example is PdfExample =>
        example.origin === 'source_pdf' && example.level === level && example.sourcePdf === sourcePdf &&
        example.chapter === chapter && example.page === page && example.german === german && example.arabic === null)
      if (match && origin === 'source_pdf' && isText(arabic) && !translations.has(match)) {
        translations.set(match, { arabic, automatic })
      }
      continue
    }
    if (preferredExample(entry.examples, level)) continue
    const examples = additions.get(entry.id) ?? []
    if (examples.some(example => example.level === level)) continue
    const common: ExampleText = { entryId: entry.id, german, arabic, level,
      ...(automatic ? { localApproval: automaticExampleApproval } : {}) }
    examples.push(origin === 'source_pdf' ? {
      ...common, origin, sourcePdf, chapter, page, verificationStatus: 'automated_checked',
      ...(arabic ? { arabicOrigin: 'authored' as const } : {}),
    } : { ...common, origin, verificationStatus: automatic ? automaticExampleApproval : 'reviewed' })
    additions.set(entry.id, examples)
  }
  return entries.map(entry => {
    const added = additions.get(entry.id)
    if (!added && !entry.examples.some(example => example.origin === 'source_pdf' && translations.has(example))) return entry
    const examples = [...entry.examples.map((example): ExampleSentence => {
      if (example.origin !== 'source_pdf') return example
      const translation = translations.get(example)
      return translation ? { ...example, arabic: translation.arabic, arabicOrigin: 'authored',
        ...(translation.automatic ? { arabicLocalApproval: automaticExampleApproval } : {}) } : example
    }), ...(added ?? [])]
    return {
      ...entry, examples,
      incompleteExampleLevels: entry.incompleteExampleLevels.filter(level => !preferredExample(examples, level)),
    }
  })
}

function readAuthoredExamples(input: unknown) {
  if (!Array.isArray(input)) throw new Error('Authored examples must be a JSON array.')
  const byEntry = new Map<string, AuthoredExample[]>()
  for (const [index, value] of input.entries()) {
    const { entryId, german, arabic, level, origin, verificationStatus } = asObject(value)
    if (!isText(entryId) || !isText(german) || !/\p{Script=Latin}/u.test(german) ||
        !isLevel(level) || origin !== 'authored' ||
        (verificationStatus !== 'reviewed' && verificationStatus !== 'needs_manual_review') ||
        !(isText(arabic) && /\p{Script=Arabic}/u.test(arabic) ||
          arabic === null && verificationStatus === 'needs_manual_review')) {
      throw new Error('Invalid authored example at index ' + index + '.')
    }
    const examples = byEntry.get(entryId) ?? []
    if (examples.some(example => example.level === level)) {
      throw new Error('Duplicate authored example for ' + entryId + ' at ' + level + '.')
    }
    examples.push({ entryId, german, arabic, level, origin, verificationStatus })
    byEntry.set(entryId, examples)
  }
  return byEntry
}

function isLocallyReviewed(source: Record<string, unknown>) {
  return source.approval_status === 'approved' &&
    (source.review_method === 'ai_pdf_visual' || source.review_method === 'user_approval_after_pdf_match') &&
    source.verification_status === 'automated_pass'
}

export function readVerifiedPilot(input: unknown, authoredInput: unknown = [], localInput: unknown = []): PilotEntry[] {
  return readQuizEntries(input, authoredInput, localInput)
}

export function readAutomaticallyValidated(input: unknown): PilotEntry[] {
  return readQuizEntries([], [], input, true)
}

function readQuizEntries(
  input: unknown, authoredInput: unknown, localInput: unknown, automatic = false,
): PilotEntry[] {
  if (!Array.isArray(input)) throw new Error('The verified pilot must be a JSON array.')
  if (!Array.isArray(localInput)) throw new Error('The local quiz projection must be a JSON array.')
  const ids = new Set<string>()
  const authored = readAuthoredExamples(authoredInput)

  return [...input, ...localInput].map((value: unknown, index) => {
    const local = index >= input.length
    const row = asObject(value)
    const quiz = asObject(row.quiz)
    const { id, german, arabic_translations, part_of_speech, article, synonyms } = row
    const { german_to_arabic, arabic_to_german_prompts, verb_translation, adjective_translation } = quiz
    const sources = Array.isArray(row.sources) ? row.sources.map(asObject) : []
    const sourceLevels = sources.map(source => source.level).filter(isLevel)

    const approved = automatic
      ? row.reliability === 'automatically_validated' && sources.length > 0 && sources.every(source =>
        isLevel(source.level) && source.source_pdf === source.level + '.pdf' &&
        Number.isInteger(source.chapter_number) && Number(source.chapter_number) > 0 &&
        Number.isInteger(source.source_page) && Number(source.source_page) > 0 &&
        (source.verification_status === 'automated_pass' || source.verification_status === 'manually_verified'))
      : local
      ? row.approval_status === 'approved' && sources.some(isLocallyReviewed)
      : row.verification_status === 'manually_verified' &&
        sources.some(source => source.verification_status === 'manually_verified')

    if (
      !isText(id) || ids.has(id) || !isText(german) ||
      !isText(part_of_speech) || !parts.has(part_of_speech) ||
      !(article === null || (part_of_speech === 'noun' && articles.includes(article as Article))) ||
      !isTextList(arabic_translations) || !arabic_translations.length ||
      arabic_translations.some(text => !/\p{Script=Arabic}/u.test(text)) ||
      !(synonyms === null || isTextList(synonyms)) ||
      !approved || quiz.eligible !== true ||
      sourceLevels.length !== sources.length ||
      sources.some(source => source.verification_status === 'needs_manual_review') ||
      typeof german_to_arabic !== 'boolean' || typeof quiz.article !== 'boolean' ||
      typeof verb_translation !== 'boolean' || typeof adjective_translation !== 'boolean' ||
      !isTextList(arabic_to_german_prompts) ||
      arabic_to_german_prompts.some(prompt => !arabic_translations.includes(prompt)) ||
      (quiz.article && (!article || part_of_speech !== 'noun')) ||
      (verb_translation && (!german_to_arabic || part_of_speech !== 'verb')) ||
      (adjective_translation && (!german_to_arabic || part_of_speech !== 'adjective')) ||
      !(german_to_arabic || quiz.article || arabic_to_german_prompts.length)
    ) {
      throw new Error('The verified pilot contains an invalid or unverified row at index ' + index + '.')
    }

    ids.add(id)
    const entryLevels = levels.filter(level => sourceLevels.includes(level))
    const examples: ExampleSentence[] = automatic ? [] : sources.flatMap(source => verifiedExample(source, id, local))
    examples.push(...(authored.get(id) ?? []).filter(example =>
      example.verificationStatus === 'reviewed' && entryLevels.includes(example.level)))
    const incompleteExampleLevels = levels.filter(level =>
      (level === 'A2' || entryLevels.includes('A1')) && !preferredExample(examples, level))

    // Only fields used by the app enter the browser bundle.
    return {
      id, german, article: article as Article | null, part_of_speech: part_of_speech as PartOfSpeech,
      arabic_translations, synonyms: synonyms ?? [],
      levels: entryLevels,
      examples,
      incompleteExampleLevels,
      quiz: {
        german_to_arabic, arabic_to_german_prompts, article: quiz.article,
        verb_translation, adjective_translation,
      },
    }
  })
}
