import { isLevel, type Level } from './pilot.ts'

export const studyTypes = ['cloze', 'flashcard', 'verb', 'grammar', 'reading',
  'order', 'case', 'error', 'transform', 'writing'] as const
export type StudyType = typeof studyTypes[number]
export type StudyKind = 'a1-book' | 'a2-book' | 'a1-vocab' | 'a2-vocab'

type Source = { id: StudyKind; pages: number; sha256: string }
export type StudyReference = { document: StudyKind; page: number }
export interface StudyChapter {
  id: string
  title: string
  source: StudyKind
  number: number
  overviewPage: number
  startPage: number
  endPage: number
  workbookPage: number
  summaryPage: number
  assessmentPage: number
  objectives: string[]
  themes: string[]
  grammar: string[]
  pronunciation: string[]
  pageCandidates: Record<string, number[]>
}
export interface StudyLesson {
  topic: string
  chapter: string
  title: string
  explanation: string
  german: string
  arabic: string
  source: StudyReference
  origin: 'authored'
  verification: 'editorial_checked'
}

export interface StudyQuestion extends Omit<StudyLesson, 'title'> {
  id: string
  type: StudyType
  prompt: string
  instruction: string
  answers: string[]
  choices?: string[]
  tokens?: string[]
  passageArabic?: string
  model?: string
}

export interface StudyPack {
  format: 'german-quiz-study'
  version: 1
  sources: Source[]
  chapters: StudyChapter[]
  lessons: StudyLesson[]
  questions: StudyQuestion[]
}

const sourceKinds: StudyKind[] = ['a1-book', 'a2-book', 'a1-vocab', 'a2-vocab']
const expectedPages = [276, 292, 62, 50]
const text = (value: unknown) => typeof value === 'string' && value.length < 12000 && !/[\u0000\uFFFD\u202A-\u202E]/u.test(value)
const arabic = (value: unknown) => text(value) && /\p{Script=Arabic}/u.test(value as string)
const german = (value: unknown) => text(value) && /\p{Script=Latin}/u.test(value as string)
const textList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= 80 && value.every(item => text(item) && item.trim())
const int = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function list(value: unknown, max: number, field: string) {
  if (!Array.isArray(value) || !value.length || value.length > max) throw new Error('Invalid ' + field)
  return value.map(record)
}

export function studyLevel(chapter: string): Level {
  const level = chapter.split(':')[0]
  if (!isLevel(level)) throw new Error('Invalid level')
  return level
}

export function normalizeStudyAnswer(value: string, language: 'de' | 'ar' = 'de') {
  const spaces = value.normalize('NFC').trim().replace(/\s+/gu, ' ').replace(/[.!?؟]+$/u, '').trim()
  return language === 'ar' ? spaces.replace(/[\p{M}ـ]/gu, '').replace(/[أإآٱ]/gu, 'ا') : spaces
}

const keys = (values: string[], lang: 'ar' | 'de' = 'de') => new Set(values.map(value => normalizeStudyAnswer(value, lang)))

export function validateStudyPack(value: unknown): StudyPack {
  const data = record(value)
  if (data.format !== 'german-quiz-study' || data.version !== 1) throw new Error('Unsupported study package')
  const sources = list(data.sources, 4, 'sources')
  if (sources.length !== 4 || sourceKinds.some((id, index) => {
    const item = sources.find(source => source.id === id)
    return item?.pages !== expectedPages[index] || typeof item?.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(item.sha256)
  })) throw new Error('Invalid source inventory')
  const chapters = list(data.chapters, 24, 'chapters')
  const chapterById = new Map(chapters.map(item => [item.id, item]))
  if (chapters.length !== 24 || chapterById.size !== 24) throw new Error('Invalid chapter count')
  for (const chapter of chapters) {
    const level = typeof chapter.id === 'string' && studyLevel(chapter.id)
    const pages = sources.find(item => item.id === chapter.source)?.pages as number
    if (!int(chapter.number) || chapter.number > 12 || chapter.id !== level + ':' + chapter.number ||
        chapter.source !== (level || '').toLowerCase() + '-book' || !german(chapter.title) ||
        ![chapter.overviewPage, chapter.startPage, chapter.endPage, chapter.workbookPage, chapter.summaryPage,
          chapter.assessmentPage].every(page => int(page) && page <= pages) ||
        (chapter.startPage as number) > (chapter.endPage as number) ||
        !['objectives', 'themes', 'grammar', 'pronunciation'].every(field => textList(chapter[field]))) {
      throw new Error('Invalid chapter data')
    }
    for (const items of Object.values(record(chapter.pageCandidates))) {
      if (!Array.isArray(items) || !items.every(page => int(page) && page >= (chapter.startPage as number) &&
        page <= (chapter.endPage as number))) throw new Error('Invalid chapter page reference')
    }
    if (!chapter.pageCandidates || Array.isArray(chapter.pageCandidates) || typeof chapter.pageCandidates !== 'object') {
      throw new Error('Missing chapter index')
    }
  }

  function checked(item: Record<string, unknown>) {
    const chapter = chapterById.get(item.chapter)
    const source = record(item.source)
    if (!chapter || chapter.source !== source.document || source.page !== chapter.overviewPage ||
        item.origin !== 'authored' || item.verification !== 'editorial_checked' ||
        !german(item.german) || !arabic(item.arabic) || !arabic(item.explanation)) {
      throw new Error('Invalid reviewed material or source reference')
    }
    if (typeof item.topic !== 'string' || !item.topic.startsWith(chapter.id + ':') ||
        !/^\d+$/u.test(item.topic.split(':').at(-1) ?? '') ||
        !((chapter.grammar as string[])[Number(item.topic.split(':').at(-1))])) throw new Error('Invalid lesson topic')
  }

  const lessons = list(data.lessons, 400, 'lessons')
  const lessonByTopic = new Map(lessons.map(item => [item.topic, item]))
  if (lessonByTopic.size !== lessons.length) throw new Error('Duplicate lesson')
  for (const item of lessons) {
    checked(item)
    if (!arabic(item.title)) throw new Error('Missing lesson title')
  }
  const questions = list(data.questions, 12000, 'questions')
  const ids = new Set<string>()
  for (const question of questions) {
    checked(question)
    const { id, type, prompt, instruction, answers, choices, tokens, passageArabic } = question
    const lang = type === 'reading' || type === 'flashcard' ? 'ar' : 'de'
    const requiresChoices = ['cloze', 'case', 'verb', 'grammar', 'reading'].includes(type as string)
    if (typeof id !== 'string' || !/^[A-Za-z0-9:_-]{1,96}$/u.test(id) || ids.has(id) ||
        !studyTypes.includes(type as StudyType) || !text(prompt) || !arabic(instruction) ||
        !textList(answers) || answers.some(value => !normalizeStudyAnswer(value, lang)) ||
        (type === 'writing' ? answers.length !== 0 : answers.length === 0) ||
        lessonByTopic.get(question.topic)?.chapter !== question.chapter ||
        (type === 'writing' && (!german(question.model) || !arabic(passageArabic))) ||
        (type === 'reading' && !arabic(passageArabic))) throw new Error('Invalid practice item')
    if (choices !== undefined || requiresChoices) {
      if (!textList(choices) || choices.length < 2 || choices.length > 6 || keys(choices, lang).size !== choices.length ||
          choices.filter(choice => keys(answers, lang).has(normalizeStudyAnswer(choice, lang))).length !== 1) {
        throw new Error('Ambiguous or incomplete choices')
      }
    }
    if (type === 'order' && (!textList(tokens) || tokens.length < 2 || tokens.length > 12 ||
        !keys(answers).has(normalizeStudyAnswer(tokens.join(' '))))) throw new Error('Invalid word-order item')
    ids.add(id)
  }
  return value as StudyPack
}

export async function readStudyFile(file: File) {
  if (!file.size || file.size > 8 * 1024 * 1024) throw new Error('Invalid study file size')
  return validateStudyPack(JSON.parse((await file.text()).replace(/^\uFEFF/u, '')))
}
