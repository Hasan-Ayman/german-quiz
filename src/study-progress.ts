import { activities, type Activity } from './practice.ts'
import type { PartOfSpeech } from './pilot.ts'
import { studyTypes, type StudyQuestion } from './study-content.ts'
import { readStudyHistory, updateStudyRecord } from './study-storage.ts'

export const studyResults = ['correct', 'incorrect', 'known', 'missed', 'completed'] as const
export type StudyResult = typeof studyResults[number]
export type StudyEvent = {
  id: string
  questionId: string
  chapter: string
  topic: string
  type: StudyQuestion['type']
  evidenceVersion?: 2
  activity?: Activity
  part?: PartOfSpeech
  answer?: string
  sessionId?: string
  optionIndex?: number
  skill?: string
  time: number
  result: StudyResult
}

export const day = 86_400_000
const intervals = [1, 3, 7, 14, 30]
const scored = (item: StudyEvent) => item.result === 'correct' || item.result === 'incorrect'
const missed = (item: StudyEvent) => item.result === 'incorrect' || item.result === 'missed'
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,160}$/u.test(value)
// Printed pronoun groups are part of existing stable verb-question IDs. Accept
// those exact IDs without rewriting them or loosening event/topic identifiers.
const safeQuestionId = (value: unknown): value is string => safeId(value) || typeof value === 'string' && value.length <= 160 &&
  /^study:[A-Za-z0-9:_-]+:verb-present:(?:er\/sie\/es|sie\/Sie):A[12]:(?:[1-9]|1[0-2])$/u.test(value)

function checkedEvent(value: unknown): StudyEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid study progress record')
  const { id, questionId, chapter, topic, type, time, result, evidenceVersion, activity, part, answer, sessionId, optionIndex, skill } = value as Record<string, unknown>
  if (!safeId(id) || !safeQuestionId(questionId) || typeof chapter !== 'string' || !/^A[12]:(?:[1-9]|1[0-2])$/u.test(chapter) ||
      typeof topic !== 'string' || (topic !== '' && (!safeId(topic) || !topic.startsWith(chapter + ':'))) ||
      !(type === 'matching' || studyTypes.includes(type as typeof studyTypes[number])) || typeof time !== 'number' || !Number.isSafeInteger(time) ||
      time < 1 || time > Date.now() + day || !studyResults.includes(result as StudyResult) ||
      (type === 'writing' ? result !== 'completed' : type === 'flashcard' ? !['known', 'missed'].includes(result as string)
        : !['correct', 'incorrect'].includes(result as string))) throw new Error('Invalid study progress record')
  if ((evidenceVersion !== undefined && evidenceVersion !== 2) ||
      (activity !== undefined && (typeof activity !== 'string' || !Object.hasOwn(activities, activity))) ||
      (part !== undefined && !['noun', 'verb', 'adjective', 'adverb'].includes(part as string)) ||
      (sessionId !== undefined && !safeId(sessionId)) ||
      (optionIndex !== undefined && (typeof optionIndex !== 'number' || !Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 7)) ||
      (skill !== undefined && !safeId(skill)) ||
      (answer !== undefined && (typeof answer !== 'string' || answer.length > 2000))) throw new Error('Invalid attempt evidence')
  return { id, questionId, chapter, topic, type: type as StudyQuestion['type'], time, result: result as StudyResult,
    ...(evidenceVersion === 2 ? { evidenceVersion } : {}), ...(activity ? { activity: activity as Activity } : {}),
    ...(part ? { part: part as PartOfSpeech } : {}), ...(typeof answer === 'string' ? { answer } : {}),
    ...(typeof sessionId === 'string' ? {sessionId} : {}), ...(typeof optionIndex === 'number' ? {optionIndex} : {}),
    ...(typeof skill === 'string' ? {skill} : {}) }
}

function compareEvents(a: StudyEvent, b: StudyEvent) {
  return a.time - b.time || a.id.localeCompare(b.id)
}

export function mergeStudyProgress(...inputs: unknown[]): StudyEvent[] {
  const byId = new Map<string, StudyEvent>()
  for (const input of inputs) {
    if (!Array.isArray(input)) throw new Error('Invalid study progress')
    for (const raw of input) {
      const event = checkedEvent(raw)
      const previous = byId.get(event.id)
      if (previous && JSON.stringify(previous) !== JSON.stringify(event)) throw new Error('Conflicting activity ID')
      byId.set(event.id, event)
    }
  }
  return [...byId.values()].sort(compareEvents)
}

export function makeStudyEvent(question: StudyQuestion, result: StudyResult, id: string, answer: string, details?: {sessionId: string; optionIndex: number; skill?: string; time: number}): StudyEvent {
  return checkedEvent({ id, questionId: question.id, chapter: question.chapter, topic: question.topic,
    type: question.type, result, time: Date.now(), evidenceVersion: 2, activity: question.activity,
    part: question.part, ...(result === 'incorrect' && answer ? { answer } : {}), ...details })
}

export const answerLogPrefix = 'answer-event:'

export async function loadStudyProgress() {
  return mergeStudyProgress(...await readStudyHistory(answerLogPrefix))
}

export async function saveStudyProgress(events: unknown) {
  const existing = await loadStudyProgress()
  const merged = mergeStudyProgress(existing, events)
  const ids = new Set(existing.map(event => event.id))
  const additions = merged.filter(event => !ids.has(event.id))
  if (additions.length)
    await updateStudyRecord('progress', previous => mergeStudyProgress(previous ?? [], additions))
  return loadStudyProgress()
}

export function encodeProgress(events: StudyEvent[]) {
  return JSON.stringify({ format: 'german-quiz-study-progress', version: 2, events })
}

export async function readProgressFile(file: File) {
  if (!file.size || file.size > 32 * 1024 * 1024) throw new Error('Invalid progress file')
  const data: unknown = JSON.parse((await file.text()).replace(/^\uFEFF/u, ''))
  if (!data || typeof data !== 'object' || !('format' in data) || data.format !== 'german-quiz-study-progress' ||
      !('version' in data) || (data.version !== 1 && data.version !== 2) || !('events' in data)) throw new Error('Unsupported progress file')
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
