import type { PersonalDataset } from './personal-data'
import { levels, type Level } from './pilot.ts'
import { buildCatalog, germanKey, type Catalog, type Fact } from './quiz.ts'
import { extendWithGrammar } from './grammar-quiz.ts'
import type { ChapterKey } from './source-data'
import type { QuizSettings } from './storage'
import { ImportProblem } from './import-problem.ts'

export interface PersonalQuiz {
  dataset: PersonalDataset
  revision: string
  automaticAvailable: boolean
  catalogs: Record<Level, Catalog>
  getExpandedCatalog: (level: Level) => Catalog
  importedCounts: Record<Level, number>
  chapters?: { key: ChapterKey; level: Level; number: number; title: string }[]
}

export async function preparePersonalQuiz(dataset: PersonalDataset): Promise<PersonalQuiz> {
  const sourceRows = dataset.version === 2 ? dataset.sourceRows : undefined
  const reviewed = dataset.entries.filter(entry => entry.vocabularyStatus === 'reviewed')
  const groups = dataset.distractorGroups
  const makeCatalog = (entries: typeof reviewed, level: Level, strict: boolean) => {
    const base = buildCatalog(entries, level, strict, groups)
    return sourceRows ? extendWithGrammar(base, entries, dataset.entries, sourceRows, level, dataset.questionExclusions) : base
  }
  const catalogs = { A1: makeCatalog(reviewed, 'A1', false), A2: makeCatalog(reviewed, 'A2', false) }
  const automaticAvailable = reviewed.length !== dataset.entries.length
  const expanded = new Map<Level, Catalog>()
  function getExpandedCatalog(level: Level) {
    const existing = expanded.get(level)
    if (existing) return existing
    const catalog = makeCatalog(dataset.entries, level, true)
    expanded.set(level, catalog)
    return catalog
  }
  if (!catalogs.A2.entryCount && !(automaticAvailable && getExpandedCatalog('A2').entryCount)) {
    throw new ImportProblem('no-questions', 'The vocabulary cannot generate any safe quiz questions')
  }
  const answerData = dataset.entries.map(({ id, german, part_of_speech, article, arabic_translations, synonyms,
    levels, quiz, vocabularyStatus }) =>
    [id, german, part_of_speech, article, arabic_translations, synonyms, levels, quiz, vocabularyStatus])
  const versionedData = sourceRows ? [answerData, groups, sourceRows.map(row =>
    [row.review_fingerprint, row.verification_status, row.plural_marker, row.gradation_marker, row.derived,
      row.examples?.map(example => [example.german, example.verification_status, Boolean(example.arabic)])])] : [answerData, groups]
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(dataset.questionExclusions?.length ? [versionedData, dataset.questionExclusions] : versionedData)))
  const revision = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
  const importedCounts = Object.fromEntries(levels.map(level =>
    [level, dataset.entries.filter(entry => entry.levels.includes(level)).length])) as Record<Level, number>
  const chapters = sourceRows && [...new Map(sourceRows.map(row => {
    const key: ChapterKey = `${row.level}:${row.chapter_number}`
    return [key, { key, level: row.level, number: row.chapter_number, title: row.chapter_title }] as const
  })).values()].sort((a, b) => a.level.localeCompare(b.level) || a.number - b.number)
  return { dataset, revision, automaticAvailable, catalogs, getExpandedCatalog, importedCounts, chapters }
}

export function factType(fact: Fact) {
  if (fact.mode === 'de-ar' || fact.mode === 'ar-de') return fact.entry.part_of_speech + ':' + fact.mode
  if (fact.mode === 'verb' || fact.mode === 'adjective') return fact.mode + ':de-ar'
  return fact.mode
}

export function selectedPersonalCatalog(bank: PersonalQuiz, { level, reliability, chapters, types }: QuizSettings) {
  const catalog = bank.automaticAvailable && reliability === 'with-automatic'
    ? bank.getExpandedCatalog(level) : bank.catalogs[level]
  if (!bank.chapters || (!chapters?.length && !types)) return catalog
  const facts = new Map([...catalog.facts].filter(([, fact]) => {
    if (types && !types.includes(factType(fact))) return false
    if (!chapters?.length) return true
    const sourceChapters = fact.chapters ?? (fact.entry as PersonalDataset['entries'][number]).sources.map(source =>
      `${source.level}:${source.chapter}` as ChapterKey)
    return sourceChapters.some(chapter => (level === 'A2' || chapter.startsWith('A1:')) && chapters.includes(chapter))
  }))
  return { ...catalog, facts, entryCount: new Set([...facts.values()].map(fact => germanKey(fact.entry.german))).size }
}
