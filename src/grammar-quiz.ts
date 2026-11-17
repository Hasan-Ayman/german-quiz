import { grammarTypes, presentPronouns, type GrammarMode } from './question-types.ts'
import { arabicKey, germanKey, type Catalog, type Fact, type Text } from './quiz.ts'
import type { PersonalEntry } from './personal-data.ts'
import type { ChapterKey, SourceRow } from './source-data.ts'
import type { Level } from './pilot.ts'

interface Candidate {
  entry: PersonalEntry
  mode: GrammarMode
  variant: string
  prompt: Text
  value: Text
  hint?: Text
  exampleGerman?: string
  group: string
  chapter: ChapterKey
  page: number
  category?: boolean
}

const de = (text: string): Text => ({ text, lang: 'de' })
const ar = (text: string): Text => ({ text, lang: 'ar' })
const key = (item: Text) => item.lang === 'de' ? germanKey(item.text) : item.text.normalize('NFKC')
const literalKey = (item: Text) => item.text.normalize('NFC').replace(/\s+/gu, ' ').trim()
const maxDistractors = 16
const categories = {
  conjugation_class: 'Konjugation', regularity: 'Regelmäßigkeit', prefix_class: 'Präfix',
  reflexivity: 'Reflexivität', function_class: 'Verbgruppe',
} as const

function sourceCandidates(entry: PersonalEntry, row: SourceRow): Candidate[] {
  const items: Candidate[] = []
  if (!row.german || row.verification_status === 'needs_manual_review') return items
  const word = de(row.german)
  const allow = (value: string | null) => value && value.length <= 240 && !/[\/;\n<>\[\]#]/u.test(value)
  function add(mode: GrammarMode, value: string | null, prompt = word, options: {
    variant?: string; group?: string; category?: boolean; lang?: 'ar' | 'de'; hint?: Text; exampleGerman?: string
  } = {}) {
    if (!allow(value)) return
    items.push({ entry, mode, variant: options.variant ?? '', prompt, value: (options.lang === 'ar' ? ar : de)(value!),
      group: options.group ?? mode, category: options.category, hint: options.hint,
      exampleGerman: options.exampleGerman,
      chapter: `${row.level}:${row.chapter_number}`, page: row.source_page })
  }
  if (row.part_of_speech === 'noun') {
    const form = row.plural && /^die\s+\p{L}/u.test(row.plural) ? row.plural : null
    add('noun-plural', form)
    if (form) add('noun-singular', row.article ? row.article + ' ' + row.german : row.german, de(form))
    if (row.plural_marker === 'dash' || row.plural_marker === 'present') {
      add('noun-plural-availability', row.plural_marker === 'dash' ? 'لا يورد المصدر صيغة جمع' : 'يورد المصدر صيغة جمع',
        word, { category: true, lang: 'ar' })
    }
  } else if (row.part_of_speech === 'verb') {
    add('verb-preterite', row.preterite)
    add('verb-perfect', row.perfect && /^(?:es )?(?:hat|ist|haben|sind)\s+\S/u.test(row.perfect) ? row.perfect : null)
    if (row.preterite && row.perfect && row.derived.participle) {
      add('verb-infinitive', row.german, de(row.preterite + ' · ' + row.perfect))
    }
    add('verb-auxiliary', row.derived.auxiliary?.value ?? null, word, { category: true })
    add('verb-participle', row.derived.participle?.value ?? null)
    for (const pronoun of presentPronouns) {
      add('verb-present', row.derived.present?.[pronoun].value ?? null, de(row.german + ' · ' + pronoun),
        { variant: pronoun, group: 'verb-present:' + pronoun })
    }
    for (const [field, label] of Object.entries(categories)) {
      const detail = row.derived[field as keyof typeof categories]
      add('verb-classification', detail?.value ?? null, de(row.german + ' · ' + label),
        { variant: field, group: 'verb-classification:' + field, category: true })
    }
  } else if (row.part_of_speech === 'adjective') {
    add('adjective-comparative', row.comparative)
    add('adjective-superlative', row.superlative)
    if (row.antonyms?.length === 1) add('adjective-antonym', row.antonyms[0])
  } else if (['temporal', 'lokal', 'modal', 'kausal'].includes(row.adverb_type ?? '')) {
    add('adverb-category', row.adverb_type, word, { category: true })
  }
  // Multiple printed equivalents are retained in the dataset. No single-answer question
  // is inferred from a list with several accepted alternatives.
  if (row.synonyms?.length === 1 && germanKey(row.synonyms[0]) !== germanKey(row.german)) {
    const type = row.part_of_speech + '-synonym'
    if (Object.hasOwn(grammarTypes, type)) add(type as GrammarMode, row.synonyms[0])
  }
  if (entry.quiz.german_to_arabic && row.arabic_translations?.length) {
    for (const [index, example] of (row.examples ?? []).entries()) {
      if (!example.arabic || !allow(example.arabic) || example.verification_status === 'needs_review' || !example.example_review) continue
      add((row.part_of_speech + '-context') as GrammarMode, example.german, ar(example.arabic),
        { variant: row.id + ':' + index,
          hint: ar(row.arabic_translations[0]), exampleGerman: example.german })
    }
  }
  return items
}

export function extendWithGrammar(
  catalog: Catalog, entries: PersonalEntry[], allEntries: PersonalEntry[], rows: SourceRow[], level: Level,
): Catalog {
  const bySource = new Map(rows.map(row => [row.id, row]))
  const allowed = new Set(entries.map(entry => entry.id))
  const candidates = allEntries.flatMap(entry => entry.sources.flatMap(ref => {
    const row = bySource.get(ref.id)
    return row ? sourceCandidates(entry, row) : []
  }))
  const byPrompt = new Map<string, Set<string>>()
  const byGroup = new Map<string, Candidate[]>()
  const globalSynonyms = new Map<string, Set<string>>()
  const unresolved = new Set(rows.filter(row => row.verification_status === 'needs_manual_review' && row.german)
    .map(row => germanKey(row.german!)))
  for (const row of rows) {
    if (!row.german) continue
    const head = row.part_of_speech + ':' + germanKey(row.german)
    const values = globalSynonyms.get(head) ?? new Set<string>()
    for (const synonym of row.synonyms ?? []) values.add(germanKey(synonym))
    globalSynonyms.set(head, values)
  }
  // Ambiguity is checked across levels and source occurrences before the working pool is narrowed.
  for (const item of candidates) {
    const promptKey = identity(item)
    const values = byPrompt.get(promptKey) ?? new Set<string>()
    values.add(item.exampleGerman ? germanKey(item.value.text) : literalKey(item.value))
    byPrompt.set(promptKey, values)
    const options = byGroup.get(item.group) ?? []
    if (allowed.has(item.entry.id) && (level === 'A2' || item.chapter.startsWith('A1:'))) options.push(item)
    byGroup.set(item.group, options)
  }
  const facts = new Map(catalog.facts)
  for (const item of candidates) {
    const entry = item.entry
    if (!allowed.has(entry.id) || (level === 'A1' && !item.chapter.startsWith('A1:')) || unresolved.has(germanKey(entry.german)) ||
        (byPrompt.get(identity(item))?.size ?? 0) !== 1) continue
    const id = entry.id + ':' + item.mode + (item.variant ? ':' + item.variant : '')
    const previous = facts.get(id)
    if (previous) {
      if (identity(item) === identity({ ...item, prompt: previous.prompt, hint: previous.hint }) &&
          key(item.value) === key(previous.correct) && !previous.chapters?.includes(item.chapter)) {
        previous.chapters?.push(item.chapter)
        if (previous.sourcePages) previous.sourcePages[item.chapter] = item.page
      }
      continue
    }
    const relevant = byGroup.get(item.group) ?? []
    const optionCount = item.category ? Math.min(new Set(relevant.map(other => key(other.value))).size, 4) : 4
    if (optionCount < 2) continue
    const choiceKeys = new Set([key(item.value)])
    const distractors: Fact['distractors'] = []
    const synonyms = globalSynonyms.get(entry.part_of_speech + ':' + germanKey(entry.german))
    const offset = Math.max(0, relevant.indexOf(item))
    for (let step = 1; step <= relevant.length && distractors.length < maxDistractors; step++) {
      const other = relevant[(offset + step) % relevant.length]
      const normalized = key(other.value)
      if (!normalized || choiceKeys.has(normalized) ||
          (item.exampleGerman && ((byPrompt.get(identity(other))?.size ?? 0) !== 1 ||
            similarSentences(item.prompt.text, other.prompt.text))) ||
          (!item.category && (!catalog.compatible(entry.id, other.entry.id) ||
            (item.mode.endsWith('-synonym') && synonyms?.has(normalized))))) continue
      choiceKeys.add(normalized)
      distractors.push({ ...other.value, id: 'form-' + distractors.length })
    }
    if (distractors.length < optionCount - 1) continue
    facts.set(id, {
      id, entry, mode: item.mode, prompt: item.prompt, hint: item.hint, exampleGerman: item.exampleGerman,
      optionCount, chapters: [item.chapter], sourcePages: { [item.chapter]: item.page },
      correct: { ...item.value, id: 'form-answer' }, distractors,
    })
  }
  return { ...catalog, facts, entryCount: new Set([...facts.values()].map(fact => germanKey(fact.entry.german))).size }
}

function identity(item: Candidate) {
  if (item.exampleGerman) return item.mode + ':' + arabicKey(item.prompt.text)
  return item.mode + ':' + literalKey(item.prompt).toLocaleLowerCase('de') + ':' + (item.hint?.text ?? '')
}

function similarSentences(first: string, second: string) {
  const left = arabicKey(first)
  const right = arabicKey(second)
  if (left === right) return true
  const words = new Set(left.split(' '))
  const other = new Set(right.split(' '))
  const shared = [...words].filter(word => other.has(word)).length
  return shared >= 2 && shared / Math.max(words.size, other.size) >= 0.66
}
