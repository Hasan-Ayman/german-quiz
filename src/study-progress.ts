import { studyTypes, type StudyQuestion, type StudyType } from './study-content.ts'
import { readStudyRecord, updateStudyRecord } from './study-storage.ts'

export const studyResults = ['correct', 'incorrect', 'known', 'missed', 'completed'] as const
export type StudyResult = typeof studyResults[number]
export type StudyEvent = {
  id: string
  questionId: string
  chapter: string
  topic: string
  type: StudyType
  time: number
  result: StudyResult
}

export const day = 86_400_000
const intervals = [1, 3, 7, 14, 30]
const scored = (item: StudyEvent) => item.result === 'correct' || item.result === 'incorrect'
const missed = (item: StudyEvent) => item.result === 'incorrect' || item.result === 'missed'
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,160}$/u.test(value)

function checkedEvent(value: unknown): StudyEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid study progress record')
  const { id, questionId, chapter, topic, type, time, result } = value as Record<string, unknown>
  if (!safeId(id) || !safeId(questionId) || typeof chapter !== 'string' || !/^A[12]:(?:[1-9]|1[0-2])$/u.test(chapter) ||
      typeof topic !== 'string' || (topic !== '' && (!safeId(topic) || !topic.startsWith(chapter + ':'))) ||
      !studyTypes.includes(type as StudyType) || typeof time !== 'number' || !Number.isSafeInteger(time) ||
      time < 1 || time > Date.now() + day || !studyResults.includes(result as StudyResult) ||
      (type === 'writing' ? result !== 'completed' : type === 'flashcard' ? !['known', 'missed'].includes(result as string)
        : !['correct', 'incorrect'].includes(result as string))) throw new Error('Invalid study progress record')
  return { id, questionId, chapter, topic, type: type as StudyType, time, result: result as StudyResult }
}

function compareEvents(a: StudyEvent, b: StudyEvent) {
  return a.time - b.time || a.id.localeCompare(b.id)
}

export function mergeStudyProgress(...inputs: unknown[]): StudyEvent[] {
  const byId = new Map<string, StudyEvent>()
  for (const input of inputs) {
    if (!Array.isArray(input) || input.length > 30_000) throw new Error('Invalid study progress')
    for (const raw of input) {
      const event = checkedEvent(raw)
      const previous = byId.get(event.id)
      if (previous && JSON.stringify(previous) !== JSON.stringify(event)) throw new Error('Conflicting activity ID')
      byId.set(event.id, event)
      if (byId.size > 30_000) throw new Error('Study progress limit reached')
    }
  }
  return [...byId.values()].sort(compareEvents)
}

export function makeStudyEvent(question: StudyQuestion, result: StudyResult): StudyEvent {
  return checkedEvent({ id: crypto.randomUUID(), questionId: question.id, chapter: question.chapter,
    topic: question.topic, type: question.type, result, time: Date.now() })
}

export async function loadStudyProgress() {
  return mergeStudyProgress(await readStudyRecord('progress') ?? [])
}

export const saveStudyProgress = (events: unknown) =>
  updateStudyRecord('progress', previous => mergeStudyProgress(previous ?? [], events))

export function encodeProgress(events: StudyEvent[]) {
  return JSON.stringify({ format: 'german-quiz-study-progress', version: 1, events })
}

export async function readProgressFile(file: File) {
  if (!file.size || file.size > 8 * 1024 * 1024) throw new Error('Invalid progress file')
  const data: unknown = JSON.parse((await file.text()).replace(/^\uFEFF/u, ''))
  if (!data || typeof data !== 'object' || !('format' in data) || data.format !== 'german-quiz-study-progress' ||
      !('version' in data) || data.version !== 1 || !('events' in data)) throw new Error('Unsupported progress file')
  return mergeStudyProgress(data.events)
}

export function reviewSchedule(events: StudyEvent[]) {
  const schedule = new Map<string, { due: number; streak: number; needsReview: boolean }>()
  for (const event of [...events].sort(compareEvents)) {
    if (event.result === 'completed') continue
    const strike = missed(event)
    const streak = strike ? 0 : (schedule.get(event.questionId)?.streak ?? 0) + 1
    schedule.set(event.questionId, { streak, needsReview: strike,
      due: strike ? event.time : event.time + day * intervals[Math.min(streak - 1, intervals.length - 1)] })
  }
  return schedule
}

export function studyStats(events: StudyEvent[]) {
  const attempts = events.filter(scored)
  const latest = new Map(attempts.map(item => [item.questionId, item.result]))
  const correct = attempts.filter(event => event.result === 'correct').length
  const retained = [...latest.values()].filter(result => result === 'correct').length
  return { completed: new Set(events.map(event => event.questionId)).size, correct, attempts: attempts.length,
    mastered: latest.size >= 3 && retained / latest.size >= .8,
    wrong: events.filter(missed).length }
}

export function downloadStudyJson(filename: string, json: string) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
