import type { PersonalQuiz } from './personal-quiz'
import { preparePersonalQuiz } from './personal-quiz'
import type { PersonalDataset } from './personal-data'
import { loadAttempt } from './storage'
import { isLevel, articles } from './pilot'
import { isQuestionCount, modes, type Attempt, type Question } from './quiz'
import { grammarModes } from './question-types'
import { sourceFactKey } from './source-questions'
import { readStudyRecord, updateStudyRecord } from './study-storage'

export const legacySessionKey = 'legacy-quiz-sessions-v2'
export type FrozenSession = { version: 2; grading: 'choice-id-v1'; id: string; revision: string; attempt: Attempt; integrity: string; answerTimes?: (number|null)[] }
export type LegacySessions = { version: 2; sessions: FrozenSession[]; currentId?: string; recoveries: { raw: string; sessionId: string }[] }
const empty = (): LegacySessions => ({ version: 2, sessions: [], recoveries: [] })
const text = (x: unknown, max = 10000): x is string => typeof x === 'string' && x.length > 0 && x.length <= max && !/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(x)
const safeText = (x: unknown) => x === undefined || x === null || typeof x === 'string' && x.length <= 10000 && !/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(x)
const object = (x: unknown): Record<string, unknown> => {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error('Invalid saved object')
  return x as Record<string, unknown>
}

function validateQuestion(input: unknown): Question {
  const q = object(input), entry = object(q.entry), prompt = object(q.prompt)
  if (!text(q.id, 400) || ![...modes, ...grammarModes].includes(q.mode as never) || !text(entry.id, 200) ||
      !text(entry.german, 2000) || !Array.isArray(entry.arabic_translations) || !entry.arabic_translations.length ||
      !entry.arabic_translations.every(x=>text(x,3000)) || !['noun','verb','adjective','adverb'].includes(String(entry.part_of_speech)) ||
      !(entry.article === null || articles.includes(entry.article as never)) || !Array.isArray(entry.levels) || !entry.levels.length || !entry.levels.every(isLevel) ||
      !Array.isArray(entry.examples) || entry.examples.some(ex=>{const e=object(ex);return !text(e.german,3000)||!safeText(e.arabic)}) ||
      !text(prompt.text) || !['ar','de'].includes(String(prompt.lang)) || !text(q.correctId,400) ||
      !Array.isArray(q.choices) || q.choices.length<2 || q.choices.length>6) throw new Error('Incomplete frozen question')
  for (const choice of q.choices) {
    const c=object(choice)
    if (!text(c.id,400)||!text(c.text)||!['ar','de'].includes(String(c.lang))) throw new Error('Invalid frozen option')
  }
  const choices=q.choices as Question['choices']
  if (new Set(choices.map(c=>c.id)).size!==choices.length || new Set(choices.map(c=>c.lang+':'+c.text)).size!==choices.length ||
      choices.filter(c=>c.id===q.correctId).length!==1) throw new Error('Ambiguous frozen grading key')
  if(q.mode==='article' && (choices.length!==3 || q.correctId!==entry.article || choices.some(c=>c.text!==c.id||!articles.includes(c.id as never)))) throw new Error('Invalid frozen article key')
  if(q.hint!==undefined){const hint=object(q.hint);if(!text(hint.text)||!['ar','de'].includes(String(hint.lang)))throw new Error('Invalid frozen hint')}
  return q as unknown as Question
}

export function validateFrozenSession(input: unknown): FrozenSession {
  const s=object(input), a=object(s.attempt)
  if(s.integrity!==sourceFactKey(JSON.stringify({grading:s.grading,id:s.id,revision:s.revision,attempt:s.attempt})))throw new Error('Saved session integrity mismatch')
  if(s.version!==2||s.grading!=='choice-id-v1'||!text(s.id,200)||!text(s.revision,200)||
      !['random','retry'].includes(String(a.kind))||!isLevel(a.level)||!isQuestionCount(a.requestedCount)||
      !['reviewed','with-automatic'].includes(String(a.reliability))||typeof a.finished!=='boolean'||
      !Array.isArray(a.questions)||!a.questions.length||a.questions.length>Number(a.requestedCount)||
      !Array.isArray(a.answers)||!a.answers.every(x=>text(x,400))||!Number.isInteger(a.index)||Number(a.index)<0||Number(a.index)>=a.questions.length||
      a.answers.length<Number(a.index)||a.answers.length>Number(a.index)+1||
      a.finished&&(a.answers.length!==a.questions.length||Number(a.index)!==a.questions.length-1)) throw new Error('Unsupported frozen session or grading version')
  const questions=a.questions.map(validateQuestion)
  const answers=a.answers as string[]
  if(s.answerTimes!==undefined&&(!Array.isArray(s.answerTimes)||s.answerTimes.length!==answers.length||
      s.answerTimes.some(time=>time!==null&&(!Number.isSafeInteger(time)||time<1||time>Date.now()+86_400_000))))
    throw new Error('Invalid saved attempt dates')
  if(new Set(questions.map(q=>q.entry.id)).size!==questions.length)throw new Error('Duplicate frozen entry')
  for(let i=0;i<answers.length;i++)if(!questions[i].choices.some(c=>c.id===answers[i]))throw new Error('Saved answer is not an original option')
  return s as unknown as FrozenSession
}

export function freezeSession(attempt: Attempt, revision: string, id: string, answerTimes?: (number|null)[]): FrozenSession {
  const value=JSON.parse(JSON.stringify({version:2,grading:'choice-id-v1',id,revision,attempt,answerTimes}))
  // Detect accidental storage corruption; this is not an authenticity signature.
  value.integrity=sourceFactKey(JSON.stringify({grading:value.grading,id:value.id,revision:value.revision,attempt:value.attempt}))
  if(JSON.stringify(value).length>8*1024*1024)throw new Error('Saved quiz is too large')
  return validateFrozenSession(value)
}

export function readLegacySessions(value: unknown): LegacySessions {
  if(value===null||value===undefined)return empty()
  const r=object(value)
  if(r.version!==2||!Array.isArray(r.sessions)||!Array.isArray(r.recoveries))throw new Error('Invalid session archive')
  const sessions=r.sessions.map(validateFrozenSession)
  if(new Set(sessions.map(s=>s.id)).size!==sessions.length||r.currentId!==undefined&&!sessions.some(s=>s.id===r.currentId))throw new Error('Invalid saved session identity')
  for(const v of r.recoveries){const e=object(v);if(!text(e.raw,2*1024*1024)||!sessions.some(s=>s.id===e.sessionId))throw new Error('Invalid recovery reference')}
  return r as unknown as LegacySessions
}

export function originalLegacySession(raw: string | null, bank: PersonalQuiz): FrozenSession | null {
  if(!raw)return null
  const attempt=loadAttempt(raw,bank.catalogs,bank.revision,bank.automaticAvailable?{getCatalog:bank.getExpandedCatalog,revision:bank.revision}:undefined)
  return attempt?freezeSession(attempt,bank.revision,'legacy:'+sourceFactKey(raw)):null
}

export async function recoverBeforeImport(raw: string | null, vocabulary: PersonalDataset | null) {
  if(!raw||!vocabulary)return null
  const bank=await preparePersonalQuiz(vocabulary)
  const session=originalLegacySession(raw,bank)
  return session?{raw,session}:null
}

export function addLegacyRecovery(value: unknown, recovery: {raw:string;session:FrozenSession}): LegacySessions {
  const data=readLegacySessions(value)
  if(data.recoveries.some(r=>r.raw===recovery.raw))return data
  return {...data,sessions:data.sessions.some(s=>s.id===recovery.session.id)?data.sessions:[...data.sessions,recovery.session],
    recoveries:[...data.recoveries,{raw:recovery.raw,sessionId:recovery.session.id}]}
}

export async function loadLegacySession(bank: PersonalQuiz, raw: string | null, factory = indexedDB) {
  const archive=readLegacySessions(await readStudyRecord(legacySessionKey,factory))
  const id=archive.currentId??archive.recoveries.find(r=>r.raw===raw)?.sessionId
  const session=archive.sessions.find(s=>s.id===id)??originalLegacySession(raw,bank)
  return {session,archive,issue:!session&&raw?'تعذّر استئناف الاختبار القديم بأمان: لا تتوفر نسخة مطابقة لأسئلته ومفتاح تصحيحه. السجل الأصلي محفوظ. يمكن استرداده باستيراد الحزمة الأصلية التي بدأت بها الاختبار.':''}
}

export async function saveLegacySession(session: FrozenSession, factory = indexedDB) {
  validateFrozenSession(session)
  await updateStudyRecord(legacySessionKey,value=>{
    const data=readLegacySessions(value),old=data.sessions.find(s=>s.id===session.id)
    if(old){
      if(JSON.stringify(old.attempt.questions)!==JSON.stringify(session.attempt.questions)||old.revision!==session.revision||
          old.attempt.answers.some((answer,i)=>session.attempt.answers[i]!==answer)||
          old.answerTimes?.some((time,i)=>time!==null&&session.answerTimes?.[i]!==time)||
          old.attempt.index>session.attempt.index||old.attempt.finished&&!session.attempt.finished)throw new Error('A stale session cannot replace recorded progress')
    }
    return {...data,currentId:session.id,sessions:old?data.sessions.map(s=>s.id===session.id?session:s):[...data.sessions,session]}
  },factory)
}

export async function selectLegacySession(id: string, factory = indexedDB) {
  await updateStudyRecord(legacySessionKey,value=>{const data=readLegacySessions(value);if(!data.sessions.some(s=>s.id===id))throw new Error('Unknown saved session');return {...data,currentId:id}} ,factory)
}
