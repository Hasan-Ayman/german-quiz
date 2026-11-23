import type { PersonalDataset, PersonalEntry } from './personal-data.ts'
import type { SourceRow } from './source-data.ts'
import type { SourceActivity, SourcePassage, StudyQuestion } from './study-content.ts'

export const sourceFields = ['article', 'plural', 'preterite', 'perfect', 'comparative', 'superlative'] as const
export type PrintedField = typeof sourceFields[number]
const labels: Record<PrintedField, [string, string]> = {
  article: ['أداة التعريف', 'المطلوب أداة الاسم المفرد في حالة الرفع كما هي في قائمة المصدر.'],
  plural: ['صيغة الجمع', 'المطلوب صيغة الجمع الكاملة، بما فيها الأداة، كما هي في قائمة المصدر.'],
  preterite: ['صيغة Präteritum', 'المطلوب صيغة الماضي البسيط المطبوعة في قائمة المصدر.'],
  perfect: ['صيغة Perfekt', 'المطلوب الماضي المركّب كاملًا، مع الفعل المساعد، كما هو في قائمة المصدر.'],
  comparative: ['صيغة المقارنة', 'المطلوب درجة المقارنة المطبوعة في قائمة المصدر.'],
  superlative: ['صيغة التفضيل', 'المطلوب درجة التفضيل الكاملة كما هي في قائمة المصدر.'],
}

export function sourceForm(row: SourceRow, field: PrintedField) {
  const part = field === 'article' || field === 'plural' ? 'noun' :
    field === 'preterite' || field === 'perfect' ? 'verb' : 'adjective'
  const value = row[field]
  if (row.part_of_speech !== part || row.verification_status === 'needs_manual_review' ||
      row.validation_issues.length || row.extraction_flags.length || !value ||
      /[\/;\n<>\[\]#\p{C}]/u.test(value)) return null
  if (field === 'article' && !['der', 'die', 'das'].includes(value)) return null
  if (field === 'plural' && (row.plural_marker !== 'present' || !/^die\s+\p{L}/u.test(value))) return null
  if ((field === 'comparative' || field === 'superlative') && row.gradation_marker !== 'present') return null
  return value
}

function printedExplanation(row: SourceRow, field: PrintedField, value: string) {
  if (field === 'article') {
    const gender = { der: 'المذكر', die: 'المؤنث', das: 'المحايد' }[value as 'der' | 'die' | 'das']
    return 'الأداة المطبوعة للاسم «' + row.german + '» هي «' + value + '»، وتدل على الجنس النحوي ' +
      gender + ' في صيغة المفرد المرفوع. يختبر السؤال أداة الاسم، وليس معناه أو صيغة جمعه.'
  }
  if (field === 'plural') return 'المفرد هو «' + row.german + '»، والجمع المطبوع هو «' + value +
    '». تُكتب هنا صيغة الجمع كاملة مع die؛ وهي أداة الجمع في حالة الرفع للأجناس الثلاثة.'
  if (field === 'preterite') return 'الصيغة «' + value + '» هي Präteritum المدرجة للفعل «' + row.german +
    '» في المصدر.' + (row.perfect ? ' أما صيغة Perfekt المدرجة فهي «' + row.perfect +
      '»؛ والمطلوب في هذا السؤال الماضي البسيط.' : ' المطلوب صيغة الماضي البسيط كما طُبعت.')
  if (field === 'perfect') return 'الصيغة المطبوعة هي «' + value +
    '». يتكوّن Perfekt هنا من الفعل المساعد مع Partizip II. تُكتب الصيغة كاملة، ولا يكفي حذف الفعل المساعد.' +
    (row.preterite ? ' ويورد المصدر «' + row.preterite + '» في خانة Präteritum.' : '')
  return 'الصفة الأصلية «' + row.german + '». الصيغة «' + value + '» هي ' +
    (field === 'comparative' ? 'درجة المقارنة (Komparativ)' : 'درجة التفضيل (Superlativ)') +
    ' المدرجة في المصدر؛ يحافظ الجواب على جميع أجزاء الصيغة المطبوعة.'
}

export function sourceFactKey(text: string) {
  let hash = 14695981039346656037n
  for (const letter of text) hash = BigInt.asUintN(64, (hash ^ BigInt(letter.codePointAt(0)!)) * 1099511628211n)
  return hash.toString(16)
}

export function makeSourceQuestion(entry: PersonalEntry, row: SourceRow, field: PrintedField): StudyQuestion | null {
  const value = sourceForm(row, field)
  if (!value || !entry.sources.some(source => source.id === row.id)) return null
  const activity = row.part_of_speech === 'noun' ? 'nouns' : row.part_of_speech === 'verb' ? 'verb' : 'grammar'
  return {
    id: 'pdf-form:' + row.id + ':' + field + ':' + sourceFactKey(JSON.stringify([entry.id, entry.german, value])), chapter: row.level + ':' + row.chapter_number, topic: '',
    type: 'vocabulary', activity, origin: 'source_derived', verification: 'automated_checked',
    source: { document: row.level === 'A1' ? 'a1-vocab' : 'a2-vocab', page: row.source_page },
    sourceEvidence: { entryId: entry.id, rowId: row.id, field },
    prompt: entry.german, promptLanguage: 'de', answerLanguage: 'de',
    hint: { text: entry.arabic_translations.join(' / '), lang: 'ar' },
    instruction: 'اكتب ' + labels[field][0] + ' كما وردت في المصدر.',
    answers: [value], german: [entry.article, entry.german].filter(Boolean).join(' '),
    arabic: entry.arabic_translations.join(' / '), explanation: printedExplanation(row, field, value), part: entry.part_of_speech,
    practiceKey: entry.id,
  }
}

export function availableStudyQuestions(questions: StudyQuestion[], entries: PersonalEntry[], expanded: boolean, exclusions: PersonalDataset['questionExclusions'] = []) {
  const reviewed = new Set(entries.filter(entry => entry.vocabularyStatus === 'reviewed').map(entry => entry.id))
  const fieldModes = {article:'article',plural:'noun-plural',preterite:'verb-preterite',perfect:'verb-perfect',comparative:'adjective-comparative',superlative:'adjective-superlative'}
  return questions.filter(item => item.type !== 'writing' && !exclusions.some(exclusion=>item.sourceEvidence?.rowId===exclusion.sourceRowId&&fieldModes[item.sourceEvidence.field]===exclusion.mode) && (expanded || item.sourceVocabularyReview !== 'automatically_validated') &&
    (expanded || item.origin !== 'source_derived' || item.type === 'reading' || Boolean(item.sourceActivityRef) ||
      reviewed.has(item.sourceEvidence?.entryId ?? '')))
}

export function conflictingPrintedFacts(rows: SourceRow[]) {
  const facts = new Map<string, Set<string>>()
  for (const row of rows) {
    if (!row.german) continue
    for (const field of sourceFields) {
      const value = row[field]
      if (!value) continue
      const key = printedFactKey(row, field)
      const values = facts.get(key) ?? new Set<string>()
      values.add(value.normalize('NFC').trim().replace(/\s+/gu, ' '))
      facts.set(key, values)
    }
  }
  return new Set([...facts].filter(([, values]) => values.size > 1).map(([key]) => key))
}

export const printedFactKey = (row: SourceRow, field: PrintedField) =>
  JSON.stringify([row.german?.normalize('NFC'), row.part_of_speech, field])

export function validateSourceQuestions(questions: StudyQuestion[], vocabulary: PersonalDataset, passages: SourcePassage[] = [], activities: SourceActivity[] = []) {
  if (!Array.isArray(passages) || passages.length > 2000) throw new Error('Invalid passage archive')
  const byPassage = new Map(passages.map(passage => [passage.id, passage]))
  if (byPassage.size !== passages.length) throw new Error('Duplicate passage identity')
  for (const passage of passages) {
    if (!passage || typeof passage.id !== 'string' || !/^pdf-reading:[a-z0-9:-]+$/u.test(passage.id) ||
        passage.provenance !== 'source_extracted' || passage.verification !== 'ai_pdf_visual_review' ||
        passage.translationOrigin !== 'generated_verified' || typeof passage.german !== 'string' ||
        !passage.german.trim() || typeof passage.arabic !== 'string' || !/\p{Script=Arabic}/u.test(passage.arabic) ||
        !Array.isArray(passage.bbox) || passage.bbox.length !== 4 || !passage.bbox.every(Number.isFinite)) {
      throw new Error('Invalid reviewed passage')
    }
  }
  if (!Array.isArray(activities) || activities.length > 4000) throw new Error('Invalid source activity archive')
  const byActivity = new Map(activities.map(activity => [activity.id, activity]))
  if (byActivity.size !== activities.length) throw new Error('Duplicate source activity')
  for (const activity of activities) {
    if (!activity || activity.verification !== 'ai_pdf_visual_review' || activity.humanVerified !== false ||
        !['printed_exercise', 'table_derived'].includes(activity.evidence?.kind) ||
        !activity.evidence.text?.trim() || activity.evidence.page !== activity.source.page ||
        activity.id !== activity.question?.id || activity.chapter !== activity.question.chapter ||
        activity.question.sourceActivityRef !== activity.id ||
        JSON.stringify(activity.source) !== JSON.stringify(activity.question.source)) throw new Error('Invalid reviewed source activity')
  }
  const conflicts = conflictingPrintedFacts(vocabulary.sourceRows ?? [])
  const rows = new Map(vocabulary.sourceRows?.map(row => [row.id, row]) ?? [])
  const entries = new Map(vocabulary.entries.map(entry => [entry.id, entry]))
  for (const question of questions) {
    if (question.origin !== 'source_derived') continue
    if (question.sourceActivityRef) {
      const activity = byActivity.get(question.sourceActivityRef)
      if (!activity || activity.id !== question.id ||
          Object.keys({ ...activity.question, ...question }).some(key =>
            JSON.stringify(activity.question[key as keyof StudyQuestion]) !== JSON.stringify(question[key as keyof StudyQuestion]))) {
        throw new Error('Source activity differs from reviewed evidence')
      }
      continue
    }
    if (question.type === 'reading') {
      const passage = byPassage.get(question.passageRef ?? '')
      if (!passage || passage.chapter !== question.chapter || question.prompt !== passage.german ||
          question.passageArabic !== passage.arabic || !question.readingEvidence ||
          !passage.german.includes(question.readingEvidence) ||
          JSON.stringify(passage.source) !== JSON.stringify(question.source)) throw new Error('Reading evidence does not match passage')
      continue
    }
    const proof = question.sourceEvidence
    const row = rows.get(proof?.rowId ?? '')
    const entry = entries.get(proof?.entryId ?? '')
    if (!row || !entry || !proof || !sourceFields.includes(proof.field)) throw new Error('Missing printed source fact')
    if (conflicts.has(printedFactKey(row, proof.field))) throw new Error('Conflicting printed forms')
    const expected = makeSourceQuestion(entry, row, proof.field)
    if (!expected) throw new Error('Ineligible printed source fact')
    // Only these directly supported formats may enter the source-derived bank.
    for (const name of Object.keys(expected) as (keyof StudyQuestion)[]) {
      if (JSON.stringify(expected[name]) !== JSON.stringify(question[name])) throw new Error('Printed source fact differs: ' + name)
    }
    if (question.choices || question.tokens || question.pairs || question.examples) throw new Error('Unsupported source-derived variants')
  }
}
