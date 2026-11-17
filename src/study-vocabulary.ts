import { preferredExample } from './pilot.ts'
import { germanKey, questionChoices, type Fact } from './quiz.ts'
import type { PersonalQuiz } from './personal-quiz.ts'
import type { PersonalEntry } from './personal-data.ts'
import type { StudyKind, StudyQuestion } from './study-content.ts'
import type { StudyFilter } from './study-engine.ts'

const instructions = {
  'de-ar': 'اختر المعنى العربي للكلمة.',
  'ar-de': 'اختر الكلمة الألمانية المطابقة.',
  article: 'اختر أداة التعريف للاسم في حالة الرفع.',
  'noun-plural': 'اختر صيغة الجمع كما وردت في المصدر.',
  'verb-preterite': 'اختر صيغة الماضي البسيط كما وردت في المصدر.',
  'verb-perfect': 'اختر صيغة الماضي المركّب كاملة كما وردت في المصدر.',
  'verb-auxiliary': 'اختر الفعل المساعد في صيغة الماضي المركّب المذكورة.',
  'verb-participle': 'اختر Partizip II لهذا الفعل.',
} as const
type StudyVocabularyMode = keyof typeof instructions

function rule(mode: StudyVocabularyMode, headword: string, gloss: string) {
  if (mode === 'article') return 'هذه أداة التعريف للاسم المفرد في حالة الرفع كما وردت في قائمة المفردات.'
  if (mode === 'verb-perfect' || mode === 'verb-auxiliary' || mode === 'verb-participle') {
    return 'يتكوّن الماضي المركّب في هذا الاستعمال من فعل مساعد وPartizip II. قارن إجابتك بالصيغة المذكورة في المصدر.'
  }
  if (mode === 'verb-preterite') return 'تدرّب على الصيغة المصدرية وصيغة الماضي البسيط المذكورة لهذا الفعل.'
  if (mode === 'noun-plural') return 'تُستخدم die مع الاسم المعرّف في الجمع في حالة الرفع. احفظ صيغة الجمع مع الاسم.'
  return headword + ' · ' + gloss
}

export function studyVocabularyQuestions(bank: PersonalQuiz, filter: StudyFilter, automatic: boolean) {
  if (bank.dataset.version !== 2 || !bank.dataset.sourceRows?.length) return []
  const level = filter.level === 'A1' ? 'A1' : 'A2'
  const catalog = automatic ? bank.getExpandedCatalog(level) : bank.catalogs[level]
  const result: StudyQuestion[] = []
  const ids = new Set<string>()
  for (const fact of catalog.facts.values()) {
    if (!Object.hasOwn(instructions, fact.mode)) continue
    const { mode, entry } = fact as Fact & { mode: StudyVocabularyMode; entry: PersonalEntry }
    const ref = entry.sources.find(ref => {
      const chapter = ref.level + ':' + ref.chapter
      return (filter.level === 'all' || filter.level === ref.level) &&
        (!filter.chapters.length || filter.chapters.includes(chapter)) &&
        (!fact.chapters || fact.chapters.some(item => item === chapter))
    })
    if (!ref) continue
    const chapter = ref.level + ':' + ref.chapter
    const id = 'study:' + fact.id + ':' + chapter
    if (ids.has(id)) continue
    const choices = questionChoices(fact, catalog, () => .41).map(choice => choice.text)
    const glossary = entry.arabic_translations.join(' / ')
    const example = preferredExample(entry.examples.filter(item => item.level === ref.level), ref.level)
    const lemma = [entry.article, entry.german].filter(Boolean).join(' ')
    ids.add(id)
    result.push({
      id, type: mode.startsWith('verb-') ? 'verb' : 'vocabulary', chapter, topic: '',
      source: { document: (ref.level.toLowerCase() + '-vocab') as StudyKind, page: ref.page },
      origin: 'vocabulary', verification: entry.vocabularyStatus === 'reviewed' ? 'reviewed' : 'automated_checked',
      prompt: fact.prompt.text, promptLanguage: fact.prompt.lang, answerLanguage: fact.correct.lang,
      instruction: instructions[mode], answers: [fact.correct.text], choices,
      explanation: rule(mode, lemma, glossary), german: example?.german ?? lemma, arabic: example?.arabic ?? glossary,
      practiceKey: germanKey(entry.german), part: entry.part_of_speech,
    })
  }
  return result
}
