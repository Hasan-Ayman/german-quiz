import { mistakeMastery, type TestSummary } from './focus-session.ts'
import { activities, type PracticeChapter } from './practice.ts'
import { day, type StudyEvent } from './study-progress.ts'
import type { LearningLibrary } from './learning-library.ts'
import type { FrozenSession } from './legacy-session.ts'
import { grammarTypes, isGrammarMode } from './question-types.ts'
import { isCorrect, type Question } from './quiz.ts'

const modeLabels: Record<string,string> = {
  'de-ar': 'المفردات من الألمانية إلى العربية',
  'ar-de': 'المفردات من العربية إلى الألمانية',
  article: 'أدوات التعريف',
  'verb-meaning': 'معاني الأفعال',
  adjective: 'معاني الصفات',
}
export function skillLabel(skill: string) {
  return modeLabels[skill] ?? (isGrammarMode(skill) ? grammarTypes[skill][1] :
    activities[skill as keyof typeof activities] ?? 'مهارة غير محددة')
}

type AttemptEvidence = {id: string; questionId: string; chapter?: string; skill: string; correct: boolean; time?: number}
type Totals = {attempts: number; correct: number; wrong: number; questions: Set<string>; timed: AttemptEvidence[]}
const totals = (): Totals => ({attempts:0,correct:0,wrong:0,questions:new Set(),timed:[]})
const add = (row:Totals, entry:AttemptEvidence) => {
  row.attempts++
  if (entry.correct) row.correct++
  else row.wrong++
  row.questions.add(entry.questionId)
  if(entry.time!==undefined) row.timed.push(entry)
}
const fraction = (row:Totals) => row.attempts ? row.correct/row.attempts : null
const uniqueDays = (rows: AttemptEvidence[]) => new Set(rows.map(r => Math.floor(r.time!/day))).size

export function accuracyChange(rows: AttemptEvidence[]) {
  if(rows.length<12)return null
  const middle=Math.floor(rows.length/2), first=rows.slice(0,middle), last=rows.slice(middle)
  if(Math.floor(first.at(-1)!.time!/day)===Math.floor(last[0].time!/day)||
     uniqueDays(first)<2||uniqueDays(last)<2||
     new Set(first.map(r=>r.questionId)).size<4||new Set(last.map(r=>r.questionId)).size<4)return null
  return last.filter(r=>r.correct).length/last.length-first.filter(r=>r.correct).length/first.length
}

type QuestionInfo = {id: string; chapter: string; skill: string; prompt: string; language?: 'de'|'ar'}
export function analyticsQuestionIndex(library:LearningLibrary) {
  const byId = new Map<string,QuestionInfo>()
  const byFact = new Map<string,QuestionInfo[]>()
  for(const item of library.items){
    const q=item.view
    const info={id:q.id,chapter:q.chapter,skill:q.skill??item.activity,prompt:q.prompt,language:q.promptLanguage}
    byId.set(q.id,info)
    if(q.origin==='vocabulary'&&q.id.startsWith('study:')){
      const fact=q.id.slice(6,-q.chapter.length-1)
      const key=JSON.stringify([fact,q.prompt,q.answers[0]])
      const rows=byFact.get(key)??[]
      rows.push(info)
      byFact.set(key,rows)
    }
  }
  return {byId,byFact}
}

export function legacyQuestionInfo(question:Question,index:ReturnType<typeof analyticsQuestionIndex>) {
  const correct=question.choices.find(choice=>choice.id===question.correctId)
  const matches=index.byFact.get(JSON.stringify([question.id,question.prompt.text,correct?.text]))??[]
  // Legacy quizzes did not save the tested chapter. Use an exact unique match
  // across both levels or leave the chapter unassigned.
  return matches.length===1?matches[0]:null
}

export function legacyAnswers(legacy:readonly FrozenSession[],index:ReturnType<typeof analyticsQuestionIndex>) {
  const sessions=new Map(legacy.map(session=>[session.id,session]))
  return [...sessions.values()].flatMap(({id,attempt,answerTimes})=>attempt.answers.map((choice,position)=>{
    const question=attempt.questions[position]
    const info=legacyQuestionInfo(question,index)
    return {id:id+':'+position,questionId:info?.id??'legacy-fact:'+question.id,
      chapter:info?.chapter,skill:question.mode==='verb'?'verb-meaning':question.mode,
      correct:isCorrect(question,choice),time:answerTimes?.[position]??undefined,question,choice}
  }))
}

export function legacyMistakeEvidence(rows:ReturnType<typeof legacyAnswers>) {
  return {
    seeds:[...new Set(rows.filter(row=>!row.correct&&row.time===undefined).map(row=>row.questionId))],
    graded:rows.flatMap((row):StudyEvent[]=>row.time===undefined?[]:[{
      id:'legacy:'+row.id,questionId:row.questionId,chapter:row.chapter??'',skill:row.skill,
      topic:'',type:'vocabulary',time:row.time,result:row.correct?'correct':'incorrect',
    }]),
  }
}

function periodChart(rows: AttemptEvidence[], now:number) {
  if(!rows.length)return []
  const start=Math.floor(rows[0].time!/day)
  const end=Math.max(Math.floor(now/day),Math.floor(rows.at(-1)!.time!/day))
  const width=Math.ceil((end-start+1)/24)
  const bins=Array.from({length:Math.ceil((end-start+1)/width)},(_,i)=>({
    start:(start+i*width)*day,end:Math.min(start+(i+1)*width-1,end)*day,correct:0,wrong:0,
  }))
  for(const row of rows){
    const bin=bins[Math.floor((Math.floor(row.time!/day)-start)/width)]
    if(row.correct)bin.correct++
    else bin.wrong++
  }
  return bins
}

export function analyzeAnswers(
  events:readonly StudyEvent[], history:readonly TestSummary[], legacy:readonly FrozenSession[],
  chapters:readonly PracticeChapter[], index:ReturnType<typeof analyticsQuestionIndex>, now=Date.now(),
){
  const overall=totals(), byChapter=new Map<string,Totals>(), bySkill=new Map<string,Totals>()
  const feedback=new Map<string,QuestionInfo>()
  const seen=new Set<string>(), attempts:AttemptEvidence[]=[]
  const wrongPerQuestion=new Map<string,number>()
  const mistakeChapter=new Map<string,string>(), mistakeSkill=new Map<string,string>()
  const summaries=new Set(history.filter(r=>!r.stoppedEarly&&r.total>0).map(r=>r.id))
  let undated=0, unassigned=0
  for(const event of events){
    if(seen.has(event.id))continue
    seen.add(event.id)
    const skill=event.skill??index.byId.get(event.questionId)?.skill??event.activity??event.type
    if(event.result==='incorrect'){
      mistakeChapter.set(event.questionId,event.chapter)
      mistakeSkill.set(event.questionId,skill)
    }
    if(event.result!=='correct'&&event.result!=='incorrect')continue
    attempts.push({id:event.id,questionId:event.questionId,chapter:event.chapter,skill,time:event.time,correct:event.result==='correct'})
  }
  // Preserve exact grades from saved snapshots. No timestamp is invented for
  // snapshots that predate the dated answer log.
  const originalTests=new Set(legacy.filter(s=>s.attempt.finished).map(s=>s.id)).size
  const archived=legacyAnswers(legacy,index)
  for(const {question,choice,...row} of archived){
    attempts.push(row)
    if(!row.correct){
      if(row.chapter&&!mistakeChapter.has(row.questionId))mistakeChapter.set(row.questionId,row.chapter)
      if(!mistakeSkill.has(row.questionId))mistakeSkill.set(row.questionId,row.skill)
      if(!row.chapter)feedback.set(row.questionId,{id:row.questionId,chapter:'',skill:row.skill,prompt:question.prompt.text,language:question.prompt.lang})
    }
    if(row.time===undefined)undated++
  }
  attempts.sort((a,b)=>(a.time??0)-(b.time??0)||a.id.localeCompare(b.id))
  const dates=attempts.filter(row=>row.time!==undefined)
  for(const entry of attempts){
    add(overall,entry)
    if(entry.chapter){
      const scope=byChapter.get(entry.chapter)??totals()
      add(scope,entry);byChapter.set(entry.chapter,scope)
    } else unassigned++
    const skill=bySkill.get(entry.skill)??totals()
    add(skill,entry);bySkill.set(entry.skill,skill)
    if(!entry.correct)wrongPerQuestion.set(entry.questionId,(wrongPerQuestion.get(entry.questionId)??0)+1)
  }
  const historical=legacyMistakeEvidence(archived)
  const mastery=mistakeMastery([...events,...historical.graded],historical.seeds)
  const mistakes=[...mastery].filter(([,state])=>state.errors>0).map(([id,state])=>({
    id,...state,misses:wrongPerQuestion.get(id)??0,
    info:index.byId.get(id)??feedback.get(id),
    chapter:mistakeChapter.get(id),skill:mistakeSkill.get(id),
  })).sort((a,b)=>b.misses-a.misses||a.id.localeCompare(b.id))
  const active=mistakes.filter(m=>m.active)
  const chapterMistakes=new Map<string,number>(), skillMistakes=new Map<string,number>()
  const repeatedByChapter=new Map<string,number>()
  for(const m of mistakes)if(m.chapter&&m.misses>=2)repeatedByChapter.set(m.chapter,(repeatedByChapter.get(m.chapter)??0)+1)
  for(const item of active){
    if(item.chapter)chapterMistakes.set(item.chapter,(chapterMistakes.get(item.chapter)??0)+1)
    if(item.skill)skillMistakes.set(item.skill,(skillMistakes.get(item.skill)??0)+1)
  }
  const summary=(row:Totals)=>({attempts:row.attempts,correct:row.correct,wrong:row.wrong,distinct:row.questions.size,accuracy:fraction(row),change:accuracyChange(row.timed)})
  return {
    ...summary(overall), completed:summaries.size+originalTests, stoppedEarly:new Set(history.filter(r=>r.stoppedEarly).map(r=>r.id)).size,
    undated,unassigned,active:active.length,mastered:mistakes.length-active.length,
    repeated:mistakes.filter(m=>m.misses>=2).length,nearMastery:active.filter(m=>m.streak===1).length,
    mistakes,chart:periodChart(dates,now),
    chapters:chapters.map(chapter=>({...chapter,...summary(byChapter.get(chapter.id)??totals()),active:chapterMistakes.get(chapter.id)??0,repeated:repeatedByChapter.get(chapter.id)??0})),
    skills:[...bySkill].map(([id,row])=>({id,label:skillLabel(id),...summary(row),active:skillMistakes.get(id)??0})).sort((a,b)=>b.wrong-a.wrong||b.attempts-a.attempts),
  }
}
