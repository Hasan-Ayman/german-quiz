import type { StudyQuestion } from './study-content'
import { studyResults, type StudyResult } from './study-progress'
import { readStudyRecord, updateStudyRecord } from './study-storage'

export type PracticePlan = { id: string; items: StudyQuestion[]; coverage?: { chapters: string[]; activities: string[] } }
export type PracticePosition = { index: number; results: StudyResult[]; response: string }
const planKey = 'practice-plan'
const positionKey = 'practice-position'

export const initialPosition: PracticePosition = { index: 0, results: [], response: '' }
export const storePracticePlan = (plan: PracticePlan) => updateStudyRecord(planKey, () => plan)
export const storePracticePosition = (id: string, position: PracticePosition) =>
  updateStudyRecord(positionKey, () => ({ id, ...position }))

export async function loadPracticeSession() {
  const [plan, position] = await Promise.all([
    readStudyRecord(planKey) as Promise<PracticePlan | undefined>,
    readStudyRecord(positionKey) as Promise<(PracticePosition & { id: string }) | undefined>,
  ])
  if (!plan || typeof plan.id !== 'string' || !Array.isArray(plan.items) || !plan.items.length) return null
  if (!position || position.id !== plan.id || !Number.isSafeInteger(position.index) || position.index < 0 ||
      position.index > plan.items.length || !Array.isArray(position.results) || position.results.length < position.index ||
      position.results.length > Math.min(plan.items.length, position.index + 1) ||
      !position.results.every(result => studyResults.includes(result)) || typeof position.response !== 'string') {
    return { plan, position: initialPosition }
  }
  return { plan, position }
}
