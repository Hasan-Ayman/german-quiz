import { type PersonalDataset } from './personal-data'
import { levels, type Level } from './pilot'
import { buildCatalog, type Catalog } from './quiz'
import type { QuizSettings } from './storage'

export interface PersonalQuiz {
  dataset: PersonalDataset
  revision: string
  automaticAvailable: boolean
  catalogs: Record<Level, Catalog>
  getExpandedCatalog: (level: Level) => Catalog
  importedCounts: Record<Level, number>
}

export async function preparePersonalQuiz(dataset: PersonalDataset): Promise<PersonalQuiz> {
  const reviewed = dataset.entries.filter(entry => entry.vocabularyStatus === 'reviewed')
  const groups = dataset.distractorGroups
  const catalogs = { A1: buildCatalog(reviewed, 'A1', false, groups), A2: buildCatalog(reviewed, 'A2', false, groups) }
  const automaticAvailable = reviewed.length !== dataset.entries.length
  const expanded = new Map<Level, Catalog>()
  function getExpandedCatalog(level: Level) {
    const existing = expanded.get(level)
    if (existing) return existing
    const catalog = buildCatalog(dataset.entries, level, true, groups)
    expanded.set(level, catalog)
    return catalog
  }
  if (!catalogs.A2.entryCount && !(automaticAvailable && getExpandedCatalog('A2').entryCount)) {
    throw new Error('The vocabulary cannot generate any safe quiz questions')
  }
  const answerData = dataset.entries.map(({ id, german, part_of_speech, article, arabic_translations, synonyms,
    levels, quiz, vocabularyStatus }) =>
    [id, german, part_of_speech, article, arabic_translations, synonyms, levels, quiz, vocabularyStatus])
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([answerData, groups])))
  const revision = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
  const importedCounts = Object.fromEntries(levels.map(level =>
    [level, dataset.entries.filter(entry => entry.levels.includes(level)).length])) as Record<Level, number>
  return { dataset, revision, automaticAvailable, catalogs, getExpandedCatalog, importedCounts }
}

export function selectedPersonalCatalog(bank: PersonalQuiz, { level, reliability }: QuizSettings) {
  return bank.automaticAvailable && reliability === 'with-automatic'
    ? bank.getExpandedCatalog(level) : bank.catalogs[level]
}
