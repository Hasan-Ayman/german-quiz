import { isLevel, type Level, type Reliability } from './pilot'
import { defaultQuestionCount, isQuestionCount, restoreQuestion, type Attempt, type Catalog,
  type Question, type QuestionCount } from './quiz'

const prefix = 'german-quiz:'
export type Theme = 'light' | 'dark'
export interface QuizSettings { level: Level; count: QuestionCount; reliability: Reliability }

export function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(prefix + key)
  } catch {
    return null
  }
}

export function writeLocal(key: string, value: string) {
  try {
    window.localStorage.setItem(prefix + key, value)
  } catch {
    // Quiz controls remain usable if storage is blocked or full.
  }
}

export function loadTheme(): Theme {
  const theme = readLocal('theme')
  if (theme === 'light' || theme === 'dark') return theme
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark' : 'light'
}

export function loadQuizSettings(text: string | null, automaticAvailable = false): QuizSettings {
  try {
    const saved = text ? JSON.parse(text) : null
    return {
      level: isLevel(saved?.level) ? saved.level : 'A2',
      count: isQuestionCount(saved?.count) ? saved.count : defaultQuestionCount,
      reliability: automaticAvailable && saved?.reliability === 'with-automatic' ? 'with-automatic' : 'reviewed',
    }
  } catch {
    return { level: 'A2', count: defaultQuestionCount, reliability: 'reviewed' }
  }
}

export function saveAttempt(attempt: Attempt, revision: string) {
  const { kind, level, reliability, requestedCount, index, answers, finished } = attempt
  return JSON.stringify({
    version: 1, revision, kind, level, reliability, requestedCount, index, answers, finished,
    questions: attempt.questions.map(question => ({
      id: question.id, options: question.choices.map(choice => choice.id),
    })),
  })
}

export function loadAttempt(
  text: string | null, catalogs: Record<Level, Catalog>, revision: string,
  automatic?: { getCatalog: (level: Level) => Catalog; revision: string },
): Attempt | null {
  if (!text) return null
  try {
    const {
      version, revision: savedRevision, kind, level = 'A2', requestedCount = defaultQuestionCount,
      reliability = 'reviewed',
      index, finished, answers, questions,
    } = JSON.parse(text)
    const pool = reliability === 'reviewed' ? revision
      : reliability === 'with-automatic' ? automatic?.revision : undefined
    if (version !== 1 || !pool || savedRevision !== pool ||
        !isLevel(level) || !isQuestionCount(requestedCount) ||
        (kind !== 'random' && kind !== 'retry') || typeof finished !== 'boolean' ||
        !Array.isArray(questions) || questions.length === 0 || questions.length > requestedCount ||
        !Number.isInteger(index) || index < 0 || index >= questions.length ||
        !Array.isArray(answers) || answers.length < index || answers.length > index + 1 ||
        (finished && answers.length !== questions.length)) return null

    const restored: Question[] = []
    const used = new Set<string>()
    const catalog = reliability === 'with-automatic' ? automatic!.getCatalog(level) : catalogs[level]
    for (const [questionIndex, item] of questions.entries()) {
      if (typeof item?.id !== 'string' || !Array.isArray(item.options) ||
          !item.options.every((option: unknown) => typeof option === 'string')) return null
      const question = restoreQuestion(catalog, item.id, item.options)
      if (!question || used.has(question.entry.id)) return null
      if (questionIndex < answers.length &&
          !question.choices.some(choice => choice.id === answers[questionIndex])) return null
      used.add(question.entry.id)
      restored.push(question)
    }

    return { kind, level, reliability, requestedCount, questions: restored, answers, index, finished }
  } catch {
    return null
  }
}
