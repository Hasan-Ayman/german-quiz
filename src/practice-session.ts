import type { StudyQuestion } from './study-content'
import { mergeStudyProgress, studyResults, type StudyEvent, type StudyResult } from './study-progress'
import { readStudyRecord, updateStudyRecord, updateStudyRecords, writeStudyRecords } from './study-storage'

export type PracticePlan = { id: string; items: StudyQuestion[]; coverage?: { chapters: string[]; activities: string[] } }
export type PracticePosition = { index: number; results: StudyResult[]; response: string }
const planKey = 'practice-plan-v2'
const positionKey = 'practice-position-v2'

export const initialPosition: PracticePosition = { index: 0, results: [], response: '' }
export const storePracticePlan = (plan: PracticePlan, position = initialPosition) =>
  writeStudyRecords([[planKey, plan], [positionKey, { id: plan.id, ...position }]])
export const storePracticePosition = (id: string, position: PracticePosition) =>
  updateStudyRecord(positionKey, previous => {
    const saved = previous as (PracticePosition & { id: string }) | null
    return saved?.id === id ? { id, ...position } : previous
  })

export async function savePracticeResponse(id: string, position: PracticePosition, event: StudyEvent) {
  const [history] = await updateStudyRecords(['progress', positionKey], ([previous, checkpoint]) => {
    if (Array.isArray(previous) && previous.some(item => item?.id === event.id)) return [previous, checkpoint]
    const current = checkpoint as (PracticePosition & { id: string }) | null
    if (current?.id !== id) throw new Error('The active practice plan could not be saved')
    return [mergeStudyProgress(previous ?? [], [event]), { id, ...position }]
  })
  return history as StudyEvent[]
}

export function playableSession(plan: PracticePlan, position: PracticePosition) {
  const visible = plan.items.flatMap((item, i) => item.type === 'writing' ? [] : [i])
  if (visible.length === plan.items.length) return { plan, position }
  if (!visible.length) return null
  return {
    plan: { ...plan, items: visible.map(i => plan.items[i]) },
    position: {
      index: visible.filter(i => i < position.index).length,
      results: visible.filter(i => i < position.results.length).map(i => position.results[i]),
      response: visible.includes(position.index) ? position.response : '',
    },
  }
}

function validPosition(plan: PracticePlan, position: (PracticePosition & { id: string }) | null) {
  if (!position || position.id !== plan.id || !Number.isSafeInteger(position.index) || position.index < 0 ||
      position.index > plan.items.length || !Array.isArray(position.results) || position.results.length < position.index ||
      position.results.length > Math.min(plan.items.length, position.index + 1) ||
      !position.results.every(result => studyResults.includes(result)) || typeof position.response !== 'string') {
    return initialPosition
  }
  return position
}

export async function loadPracticeSession() {
  const current = await readStudyRecord(planKey) as PracticePlan | null
  const plan = current ?? await readStudyRecord('practice-plan') as PracticePlan | null
  if (!plan || typeof plan.id !== 'string' || !Array.isArray(plan.items) || !plan.items.length) return null
  const rawPosition = await readStudyRecord(current ? positionKey : 'practice-position') as (PracticePosition & { id: string }) | null
  const session = playableSession(plan, validPosition(plan, rawPosition))
  if (!session || current) return session
  const [savedPlan, savedPosition] = await updateStudyRecords([planKey, positionKey], ([stored, checkpoint]) =>
    stored ? [stored, checkpoint] : [session.plan, { id: session.plan.id, ...session.position }])
  const migrated = savedPlan as PracticePlan
  return playableSession(migrated, validPosition(migrated, savedPosition as (PracticePosition & { id: string }) | null))
}
