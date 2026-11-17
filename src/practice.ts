import type { Level, PartOfSpeech, Reliability } from './pilot.ts'
import type { ChapterKey } from './source-data.ts'
import type { PersonalQuiz } from './personal-quiz.ts'
import { isQuestionCount, type QuestionCount } from './quiz.ts'
import { normalizeStudyAnswer, type StudyPack, type StudyQuestion } from './study-content.ts'
import { shuffled } from './study-engine.ts'
import { flashcardModes, type FlashcardMode } from './study-flashcards.ts'
import { loadQuizSettings } from './storage.ts'
import { selectableTypes } from './question-types.ts'

export const activities = {
  vocabulary: 'المفردات', nouns: 'الأدوات والجمع', flashcard: 'البطاقات', verb: 'تصريف الأفعال',
  cloze: 'إكمال الجمل', grammar: 'القواعد', case: 'الحالات الإعرابية', order: 'ترتيب الجمل',
  error: 'تصحيح الأخطاء', transform: 'تحويل الجمل', reading: 'القراءة', writing: 'الكتابة',
} as const
export type Activity = keyof typeof activities
export type Scope = Level | 'all'
export type PracticeChapter = { id: ChapterKey; level: Level; number: number; title?: string }
export type Candidate = {
  id: string
  key: string
  chapter: string
  activity: Activity
  topic: string
  part?: PartOfSpeech
  origin: StudyQuestion['origin']
  variant?: string
  make: () => StudyQuestion
}
export type Focus = 'all' | 'new' | 'missed' | 'due'
export type Preferences = {
  scope: Scope
  chapters: Partial<Record<Level, ChapterKey[]>>
  activities: Activity[] | null
  count: QuestionCount | 'all'
  reliability: Reliability
  direction: 'all' | 'de-ar' | 'ar-de'
  focus: Focus
  part: PartOfSpeech | 'all'
  difficulty: 'all' | 'direct' | 'applied'
  cards: FlashcardMode
  topic: string
  variants?: string[]
}

export const practiceLevels = ['A1', 'A2'] as const
export const levelMatches = (scope: Scope, level: Level) => scope === 'all' || scope === level
export const chapterLevel = (id: string): Level => id.startsWith('A1:') ? 'A1' : 'A2'

export function practiceChapters(bank: PersonalQuiz | null, pack: StudyPack | null): PracticeChapter[] {
  const chapterMap = new Map<ChapterKey, PracticeChapter>()
  const add = (level: Level, number: number, title?: string) => {
    const id: ChapterKey = `${level}:${number}`
    const old = chapterMap.get(id)
    chapterMap.set(id, { id, level, number, title: title || old?.title })
  }
  for (const entry of bank?.dataset.entries ?? []) {
    for (const ref of entry.sources) add(ref.level, ref.chapter, ref.chapterTitle)
  }
  for (const chapter of bank?.chapters ?? []) add(chapter.level, chapter.number, chapter.title)
  for (const chapter of pack?.chapters ?? []) add(chapterLevel(chapter.id), chapter.number, chapter.title)
  return [...chapterMap.values()].sort((a, b) => a.level.localeCompare(b.level) || a.number - b.number)
}

export function selectedChapters(chapters: readonly PracticeChapter[], prefs: Preferences) {
  return chapters.filter(item => levelMatches(prefs.scope, item.level) &&
    (prefs.chapters[item.level]?.includes(item.id) ?? true)).map(item => item.id)
}

export function setChapters(prefs: Preferences, values: readonly ChapterKey[], scope: Scope = prefs.scope): Preferences {
  const chapters = { ...prefs.chapters }
  for (const level of practiceLevels) {
    if (levelMatches(scope, level)) chapters[level] = values.filter(id => chapterLevel(id) === level)
  }
  return { ...prefs, chapters }
}

export function loadPracticePreferences(text: string | null, legacy: string | null): Preferences {
  const old = loadQuizSettings(legacy, true)
  const defaults: Preferences = { scope: old.level === 'A1' ? 'A1' : 'all', chapters: {},
    activities: null, count: old.count, reliability: old.reliability, direction: 'all',
    focus: 'all', part: 'all', difficulty: 'all', cards: 'de-ar', topic: '', variants: old.types }
  if (old.chapters?.length) {
    for (const level of practiceLevels) {
      const keys = old.chapters.filter(id => chapterLevel(id) === level)
      if (old.level === 'A2' || level === 'A1') defaults.chapters[level] = keys
    }
  }
  if (!text) return defaults
  try {
    const saved = JSON.parse(text)
    const chapters = { ...defaults.chapters }
    for (const level of practiceLevels) {
      const ids: unknown = saved.chapters?.[level]
      if (Array.isArray(ids)) chapters[level] = [...new Set(ids.filter((id): id is ChapterKey =>
        typeof id === 'string' && /^A[12]:(?:[1-9]|1[0-2])$/u.test(id) && id.startsWith(level + ':')))]
    }
    return {
      scope: ['A1', 'A2', 'all'].includes(saved.scope) ? saved.scope : defaults.scope,
      chapters,
      activities: Array.isArray(saved.activities) ? [...new Set<Activity>(saved.activities.filter((id: unknown) =>
        typeof id === 'string' && Object.hasOwn(activities, id)))] : null,
      count: saved.count === 'all' || isQuestionCount(saved.count) ? saved.count : defaults.count,
      reliability: saved.reliability === 'with-automatic' ? 'with-automatic' : 'reviewed',
      direction: ['de-ar', 'ar-de'].includes(saved.direction) ? saved.direction : 'all',
      focus: ['new', 'missed', 'due'].includes(saved.focus) ? saved.focus : 'all',
      part: ['noun', 'verb', 'adjective', 'adverb'].includes(saved.part) ? saved.part : 'all',
      difficulty: ['direct', 'applied'].includes(saved.difficulty) ? saved.difficulty : 'all',
      cards: typeof saved.cards === 'string' && Object.hasOwn(flashcardModes, saved.cards) ? saved.cards : 'de-ar',
      topic: typeof saved.topic === 'string' ? saved.topic : '',
      variants: Array.isArray(saved.variants) ? saved.variants.filter((id: string) => selectableTypes.includes(id)) : undefined,
    }
  } catch {
    return defaults
  }
}

export function fromStudyQuestion(item: StudyQuestion): Candidate {
  const language = item.answerLanguage ?? (item.type === 'flashcard' || item.type === 'reading' ? 'ar' : 'de')
  // Equal readings may ask different questions, and one example can teach several distinct facts.
  const answer = item.answers.map(value => normalizeStudyAnswer(value, language)).sort().join('/')
  const prompt = normalizeStudyAnswer(item.prompt, item.promptLanguage ?? 'de')
  const instruction = item.type === 'writing' || item.type === 'reading' ? item.instruction : ''
  const key = item.origin === 'vocabulary' ? item.id : JSON.stringify([item.type, prompt, answer, instruction])
  return { id: item.id, key, chapter: item.chapter, activity: item.type, origin: item.origin,
    topic: item.topic, part: item.part, make: () => item }
}

export function questionGroups(pool: readonly Candidate[]) {
  const groups = new Map<string, Candidate[]>()
  for (const item of pool) {
    const group = groups.get(item.key)
    if (group) group.push(item)
    else groups.set(item.key, [item])
  }
  return groups
}

export function eligiblePractice(pool: readonly Candidate[], chapters: readonly ChapterKey[], prefs: Preferences,
  practiced: ReadonlySet<string>, schedule: ReadonlyMap<string, { due: number; needsReview: boolean }>, now = Date.now()) {
  const chapterSet = new Set<string>(chapters)
  const applied = new Set<Activity>(['order', 'reading', 'writing', 'error', 'transform'])
  return pool.filter(item => chapterSet.has(item.chapter) && (!prefs.topic || prefs.topic === item.topic) &&
    (prefs.part === 'all' || prefs.part === item.part) &&
    (prefs.difficulty === 'all' || (prefs.difficulty === 'applied') === applied.has(item.activity)) &&
    (prefs.direction === 'all' || !item.variant?.includes(':') || item.variant.endsWith(':' + prefs.direction)) &&
    (prefs.variants === undefined || !item.variant || prefs.variants.includes(item.variant)) &&
    (prefs.focus === 'all' || (prefs.focus === 'new' && !practiced.has(item.id)) ||
      (prefs.focus === 'missed' && schedule.get(item.id)?.needsReview) ||
      (prefs.focus === 'due' && (schedule.get(item.id)?.due ?? Infinity) <= now)))
}

export function practiceRound(groups: ReadonlyMap<string, Candidate[]>, count: Preferences['count'], random = Math.random) {
  const groupsInOrder = shuffled([...groups.values()].map(items => shuffled(items, random)), random)
  const size = count === 'all' ? groups.size : Math.min(count, groups.size)
  const chapters = new Set(groupsInOrder.flatMap(items => items.map(item => item.chapter)))
  const kinds = new Set(groupsInOrder.flatMap(items => items.map(item => item.activity)))
  const used = new Set<string>()
  const result: Candidate[] = []
  // Give every selected type and chapter a chance before filling the remaining slots.
  while (result.length < size && (chapters.size || kinds.size)) {
    let best: Candidate | undefined
    let bestScore = 0
    for (const group of groupsInOrder) {
      if (used.has(group[0].key)) continue
      for (const item of group) {
        const score = Number(chapters.has(item.chapter)) + Number(kinds.has(item.activity))
        if (score <= bestScore) continue
        best = item
        bestScore = score
      }
      if (bestScore === 2) break
    }
    if (!best) break
    used.add(best.key)
    chapters.delete(best.chapter)
    kinds.delete(best.activity)
    result.push(best)
  }
  for (const [item] of groupsInOrder) {
    if (result.length === size) break
    if (!used.has(item.key)) result.push(item)
  }
  return shuffled(result, random)
}
