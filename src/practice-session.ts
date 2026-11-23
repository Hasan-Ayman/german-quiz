import type { StudyQuestion } from './study-content'
import { answerLogPrefix, studyResults, type StudyEvent, type StudyResult } from './study-progress'
import { readStudyRecord, updateStudyRecord, updateStudyRecords, writeStudyRecords } from './study-storage'
import { historyKey, type TestSummary } from './focus-session'

export type PracticePlan = { id: string; items: StudyQuestion[]; assessment?: boolean; coverage?: { chapters: string[]; activities: string[] } }
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

export async function finishPracticeAssessment(plan:PracticePlan, position:PracticePosition) {
  const correct=position.results.filter(result=>result==='correct').length
  const wrong=position.results.filter(result=>result==='incorrect').length
  const summary:TestSummary={id:plan.id,kind:'assessment',time:Date.now(),total:correct+wrong,correct,wrong,
    planned:plan.items.length,stoppedEarly:false}
  await updateStudyRecords([positionKey,historyKey],([previous,history])=>{
    const saved=previous as (PracticePosition & {id:string})|null
    if(saved?.id!==plan.id||!plan.assessment||position.index!==plan.items.length||saved.results.length!==position.results.length)
      throw new Error('The assessment is not ready to finish')
    const results=(history??[]) as TestSummary[]
    return [{id:plan.id,...position},results.some(row=>row.id===plan.id)?results:[...results,summary]]
  })
}

export async function savePracticeResponse(id: string, position: PracticePosition, event: StudyEvent) {
  const [,saved] = await updateStudyRecords([positionKey,answerLogPrefix+event.id], ([checkpoint,previous]) => {
    if(previous)return [checkpoint,previous]
    const current = checkpoint as (PracticePosition & { id: string }) | null
    if (current?.id !== id) throw new Error('The active practice plan could not be saved')
    if(current.results.length>position.index||current.index>position.index)return [checkpoint,previous]
    return [{ id, ...position }, {...event,sessionId:id}]
  })
  return saved as StudyEvent|null
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

export async function loadPracticeSession(migrate = true) {
  const current = await readStudyRecord(planKey) as PracticePlan | null
  const plan = current ?? await readStudyRecord('practice-plan') as PracticePlan | null
  if (!plan || typeof plan.id !== 'string' || !Array.isArray(plan.items) || !plan.items.length) return null
  const rawPosition = await readStudyRecord(current ? positionKey : 'practice-position') as (PracticePosition & { id: string }) | null
  const session = playableSession(plan, validPosition(plan, rawPosition))
  if (!session || current || !migrate) return session
  const [savedPlan, savedPosition] = await updateStudyRecords([planKey, positionKey], ([stored, checkpoint]) =>
    stored ? [stored, checkpoint] : [session.plan, { id: session.plan.id, ...session.position }])
  const migrated = savedPlan as PracticePlan
  return playableSession(migrated, validPosition(migrated, savedPosition as (PracticePosition & { id: string }) | null))
}
