import { factType, type PersonalQuiz } from './personal-quiz.ts'
import { feedbackExamples } from './pilot.ts'
import { germanKey, questionChoices, type Mode } from './quiz.ts'
import { grammarTypes, isGrammarMode } from './question-types.ts'
import type { PersonalEntry } from './personal-data.ts'
import type { StudyQuestion, StudyKind } from './study-content.ts'
import { vocabularyFlashcards, type FlashcardMode } from './study-flashcards.ts'
import { fromStudyQuestion, type Candidate, type PracticeChapter, type Activity, type Scope } from './practice.ts'

const instruction: Record<'de-ar' | 'ar-de' | 'article' | 'verb' | 'adjective', string> = {
  'de-ar': 'اختر المعنى بالعربية', 'ar-de': 'اختر الكلمة بالألمانية',
  article: 'اختر أداة التعريف في حالة الرفع', verb: 'اختر معنى الفعل بالعربية', adjective: 'اختر معنى الصفة بالعربية',
}
function group(mode: Mode): Activity {
  if (mode === 'article' || ['noun-plural', 'noun-singular', 'noun-plural-availability'].includes(mode)) return 'nouns'
  if (isGrammarMode(mode) && mode.startsWith('verb-') && !['verb-synonym', 'verb-context'].includes(mode)) return 'verb'
  if (mode === 'adjective-comparative' || mode === 'adjective-superlative') return 'grammar'
  return 'vocabulary'
}

export function vocabularyCandidates(bank: PersonalQuiz, scope: Scope, expanded: boolean): Candidate[] {
  const level = scope === 'A1' ? 'A1' : 'A2'
  const catalog = bank.automaticAvailable && expanded ? bank.getExpandedCatalog(level) : bank.catalogs[level]
  return [...catalog.facts.values()].flatMap(fact => {
    const { mode } = fact
    const entry = fact.entry as PersonalEntry
    const activity = group(mode)
    const refs = new Map<string, PersonalEntry['sources'][number]>()
    for (const ref of entry.sources) {
      const chapter = `${ref.level}:${ref.chapter}` as const
      if (fact.chapters && !fact.chapters.includes(chapter)) continue
      const exact = fact.sourcePages?.[chapter]
      if (exact !== undefined && ref.page !== exact) continue
      if (!refs.has(chapter)) refs.set(chapter, ref)
    }
    return [...refs].map(([chapter, ref]): Candidate => {
      const id = 'study:' + fact.id + ':' + chapter
      return { id, chapter, key: 'word:' + germanKey(entry.german), activity, topic: '', part: entry.part_of_speech,
        origin: 'vocabulary', variant: factType(fact), searchText: fact.prompt.text + ' ' + entry.german + ' ' + entry.arabic_translations.join(' '), make: (): StudyQuestion => {
          const examples = feedbackExamples(entry.examples.filter(example => example.level === ref.level), ref.level)
          if (fact.exampleGerman) examples.sort((a, b) => Number(b.german === fact.exampleGerman) - Number(a.german === fact.exampleGerman))
          return {
            id, chapter, type: activity === 'verb' ? 'verb' : 'vocabulary', topic: '',
            origin: 'vocabulary', verification: entry.vocabularyStatus === 'reviewed' ? 'reviewed' : 'automated_checked',
            source: { document: ref.document ?? (ref.level === 'A1' ? 'a1-vocab' : 'a2-vocab') as StudyKind, page: ref.page },
            prompt: fact.prompt.text, promptLanguage: fact.prompt.lang, answerLanguage: fact.correct.lang, hint: fact.hint,
            instruction: isGrammarMode(mode) ? grammarTypes[mode][2] : instruction[mode],
            answers: [fact.correct.text], choices: questionChoices(fact, catalog).map(item => item.text),
            german: [entry.article, entry.german].filter(Boolean).join(' '),
            arabic: entry.arabic_translations.join(' / '),
            explanation: mode === 'article' ? 'تُستعمل هذه الأداة مع الاسم المفرد في حالة الرفع.' : '',
            examples,
          }
        },
      }
    })
  })
}

export function flashcardCandidates(bank: PersonalQuiz, chapters: readonly PracticeChapter[], mode: FlashcardMode, expanded: boolean) {
  const prefix = 'card:' + mode + ':'
  const wordById = new Map(bank.dataset.entries.map(entry => [prefix + entry.id, germanKey(entry.german)]))
  return chapters.flatMap(chapter => vocabularyFlashcards(bank.dataset, {
    level: chapter.level, chapters: [chapter.id], type: 'flashcard',
  }, mode, expanded).map(item => ({ ...fromStudyQuestion(item), key: 'word:' + wordById.get(item.id) })))
}
