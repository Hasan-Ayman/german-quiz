import { datasetFormat, datasetVersion, validatePersonalDataset } from '../src/personal-data.ts'
import { readVerifiedPilot, type Level } from '../src/pilot.ts'

const words = [
  ['Name', 'الاسم في الاختبار', 'noun'], ['Vorname', 'الاسم الشخصي', 'noun'], ['Stadt', 'بلدة الاختبار', 'noun'],
  ['gern', 'برغبة', 'adverb'], ['am liebsten', 'الأحب', 'adverb'],
  ['wohnen', 'يقيم', 'verb'], ['heißen', 'يُسمّى في المثال', 'verb'], ['aktiv', 'نشيط في الاختبار', 'adjective'],
]
export const distractorGroups = [['Name', 'Vorname'], ['gern', 'am liebsten']]
export const rawPilot = Array.from({ length: 57 }, (_, index) => {
  const [german, arabic, part] = words[index] ?? ['Testwort ' + index, 'عينة ' + index,
    ['noun', 'verb', 'adjective', 'adverb'][index % 4]]
  const levels: Level[] = index === 7 || (index > 0 && index < 7) ? ['A1', 'A2'] : [index < 34 ? 'A1' : 'A2']
  const sourceStatus = 'manually_verified'
  const sources = levels.map(level => ({
    id: level.toLowerCase() + '-01-fixture-' + index,
    level, source_pdf: level + '.pdf', chapter_number: 1, source_page: index + 1,
    verification_status: index === 7 && level === 'A1' ? 'automated_pass' : sourceStatus,
    example_sentence: index === 1 || index === 7 ? 'Der Satz gehört zur Testdatei.' : null,
  }))
  return {
    id: 'test-vocabulary-' + index, german, part_of_speech: part, article: part === 'noun' ? 'der' : null,
    arabic_translations: [arabic], synonyms: index === 0 ? ['Bezeichnung'] : [],
    verification_status: sourceStatus, sources,
    quiz: { eligible: true, german_to_arabic: true, arabic_to_german_prompts: [arabic],
      article: part === 'noun', verb_translation: part === 'verb', adjective_translation: part === 'adjective' },
  }
})

export const entries = readVerifiedPilot(rawPilot)
export const revision = 'fixture-version'
export const fixtureDataset = validatePersonalDataset({ format: datasetFormat, version: datasetVersion, distractorGroups,
  entries: entries.map((entry, index) => ({
    ...entry, vocabularyStatus: index < 45 ? 'reviewed' : 'automatically_validated',
    sources: rawPilot[index].sources.map(source => ({
      id: source.id, level: source.level, sourcePdf: source.source_pdf, chapter: source.chapter_number,
      page: source.source_page, verificationStatus: source.verification_status,
    })),
  })),
})
