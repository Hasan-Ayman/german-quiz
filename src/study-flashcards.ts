import type { PersonalDataset } from './personal-data.ts'
import type { StudyKind, StudyQuestion } from './study-content.ts'
import type { StudyFilter } from './study-engine.ts'
import { preferredExample } from './pilot.ts'

export const flashcardModes = {
  'de-ar': 'الألمانية إلى العربية', 'ar-de': 'العربية إلى الألمانية',
  article: 'أداة التعريف', plural: 'المفرد إلى الجمع', past: 'المصدر إلى صيغ الماضي',
  comparison: 'درجتا المقارنة والتفضيل', sentence: 'الجملة إلى معناها', gap: 'الكلمة المفقودة',
} as const
export type FlashcardMode = keyof typeof flashcardModes

export function vocabularyFlashcards(dataset: PersonalDataset, filter: StudyFilter, mode: FlashcardMode, includeAutomatic: boolean) {
  const sourceRows = new Map(dataset.version === 2 ? dataset.sourceRows?.map(row => [row.id, row]) : [])
  const cards: StudyQuestion[] = []
  for (const entry of dataset.entries) {
    if (!includeAutomatic && entry.vocabularyStatus !== 'reviewed') continue
    const ref = entry.sources.find(source => (filter.level === 'all' || filter.level === source.level) &&
      (!filter.chapters.length || filter.chapters.includes(source.level + ':' + source.chapter)))
    if (!ref || !entry.arabic_translations.length) continue
    const original = sourceRows.get(ref.id)
    const excluded=(modes:string[])=>(dataset.questionExclusions??[]).some(e=>e.sourceRowId===ref.id&&modes.includes(e.mode))
    if(mode==='article'&&excluded(['article'])||mode==='plural'&&excluded(['noun-plural'])||
      mode==='past'&&excluded(['verb-preterite','verb-perfect'])||mode==='comparison'&&excluded(['adjective-comparative','adjective-superlative']))continue
    const gloss = entry.arabic_translations.join(' / ')
    const lemma = [entry.article, entry.german].filter(Boolean).join(' ')
    const chapter = ref.level + ':' + ref.chapter
    const example = preferredExample(entry.examples.filter(example => example.level === ref.level), ref.level)
    let prompt = lemma
    let answers = [gloss]
    let promptLanguage: 'de' | 'ar' = 'de'
    let answerLanguage: 'de' | 'ar' = 'ar'
    if (mode === 'ar-de') {
      if (!entry.quiz.arabic_to_german_prompts.length) continue
      prompt = entry.quiz.arabic_to_german_prompts[0]
      promptLanguage = 'ar'
      answers = [lemma]
      answerLanguage = 'de'
    } else if (mode === 'article') {
      if (!entry.article || !entry.quiz.article) continue
      prompt = entry.german
      answers = [entry.article]
      answerLanguage = 'de'
    } else if (mode === 'plural') {
      if (!original?.plural || original.plural_marker !== 'present' || !/^die\s/u.test(original.plural)) continue
      answers = [original.plural]
      answerLanguage = 'de'
    } else if (mode === 'past') {
      if (!original?.preterite || !original.perfect || entry.part_of_speech !== 'verb') continue
      answers = [original.preterite + ' · ' + original.perfect]
      answerLanguage = 'de'
    } else if (mode === 'comparison') {
      if (!original?.comparative || !original.superlative || original.gradation_marker !== 'present') continue
      answers = [original.comparative + ' · ' + original.superlative]
      answerLanguage = 'de'
    } else if (mode === 'sentence' || mode === 'gap') {
      if (!example?.arabic) continue
      if (mode === 'sentence') {
        prompt = example.german
        answers = [example.arabic]
      } else {
        const offset = example.german.indexOf(entry.german)
        if (offset < 0 || example.german.indexOf(entry.german, offset + entry.german.length) >= 0 ||
          /\p{L}/u.test(example.german[offset - 1] ?? '') ||
          /\p{L}/u.test(example.german[offset + entry.german.length] ?? '')) continue
        prompt = example.german.slice(0, offset) + '____' + example.german.slice(offset + entry.german.length)
        answers = [entry.german]
        answerLanguage = 'de'
      }
    }
    cards.push({ id: 'card:' + mode + ':' + entry.id, type: 'flashcard', chapter, topic: '', part: entry.part_of_speech,
      source: { document: ref.document ?? (ref.level.toLowerCase() + '-vocab') as StudyKind, page: ref.page },
      origin: 'vocabulary', verification: entry.vocabularyStatus === 'reviewed' ? 'reviewed' : 'automated_checked',
      prompt, promptLanguage, answerLanguage, answers, instruction: flashcardModes[mode],
      explanation: gloss, german: example?.german ?? lemma, arabic: example?.arabic ?? gloss })
  }
  return cards
}
