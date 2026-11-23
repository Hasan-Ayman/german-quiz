import {sourceFactKey} from './source-questions.ts'
import {checkStudyAnswer,shuffled} from './study-engine.ts'
import type {StudyQuestion} from './study-content.ts'
import {answerLogPrefix,makeStudyEvent,type StudyEvent} from './study-progress.ts'
import {readStudyRecord,updateStudyRecords} from './study-storage.ts'
import {cleanChoices} from './learning-library.ts'

export type TestAnswer={eventId:string;item:number;choice:string;correct:boolean;time:number}
export type FocusSession={version:1;snapshot:string;id:string;kind:'normal'|'mistakes'|'retry';items:StudyQuestion[];queue:number[];cursor:number;answers:TestAnswer[];startedAt:number;finished:boolean;stoppedEarly:boolean}
export type TestSummary={id:string;kind:FocusSession['kind']|'assessment';time:number;total:number;correct:number;wrong:number;planned:number;stoppedEarly:boolean}
export const focusKey='focus-test-current-v1',historyKey='focus-test-history-v1',archiveKey='focus-test-archive-v1'
export type FocusArchive={id:string;time:number;finished:boolean}
export function newFocusSession(items:StudyQuestion[],kind:FocusSession['kind'],id:string,now=Date.now()):FocusSession{
 if(!items.length||new Set(items.map(q=>q.id)).size!==items.length||items.some(q=>!cleanChoices(q)))throw Error('Unsafe test')
 return{version:1,snapshot:sourceFactKey(JSON.stringify(items)),id,kind,items,queue:items.map((_,i)=>i),cursor:0,answers:[],startedAt:now,finished:false,stoppedEarly:false}
}
export function markFocusAnswer(s:FocusSession,choice:string,time=Date.now()):FocusSession{
 if(s.finished||s.answers.length!==s.cursor)return s
 const item=s.queue[s.cursor],q=s.items[item]
 if(!q.choices?.includes(choice))throw Error('Unknown answer')
 const correct=checkStudyAnswer(q,choice),queue=[...s.queue]
 const attempts=s.answers.filter(a=>a.item===item).length+1
 if(s.kind==='mistakes'&&!correct&&attempts<3)queue.push(item)
 return{...s,queue,answers:[...s.answers,{eventId:s.id+':'+s.cursor,item,choice,correct,time}]}
}
export function nextFocusQuestion(s:FocusSession){
 if(s.finished||s.answers.length<=s.cursor)return s
 const cursor=s.cursor+1
 return{...s,cursor,finished:cursor===s.queue.length}
}
export function focusMistakes(s:FocusSession){return[...new Set(s.answers.filter(a=>!a.correct).map(a=>a.item))].map(i=>s.items[i])}
export function retryFocus(s:FocusSession,id:string,random=Math.random){return newFocusSession(focusMistakes(s).map(q=>({...q,choices:shuffled(q.choices!,random)})),'retry',id)}
export function summarizeFocus(s:FocusSession):TestSummary{
 const correct=s.answers.filter(a=>a.correct).length
 return{id:s.id,kind:s.kind,time:Date.now(),total:s.answers.length,correct,wrong:s.answers.length-correct,planned:s.items.length,stoppedEarly:s.stoppedEarly}
}
export function mistakeMastery(events:readonly StudyEvent[],seeds:readonly string[]=[]){
 const result=new Map<string,{streak:number;active:boolean;errors:number}>()
 for(const id of seeds)result.set(id,{streak:0,active:true,errors:1})
 const seen=new Set<string>()
 for(const e of [...events].sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id))){
  if(seen.has(e.id))continue;seen.add(e.id)
  if(e.result!=='correct'&&e.result!=='incorrect')continue
  const state=result.get(e.questionId)??{streak:0,active:false,errors:0}
  if(e.result==='correct'){state.streak=Math.min(2,state.streak+1);if(state.streak===2)state.active=false}
  else{state.streak=0;state.active=true;state.errors++}
  result.set(e.questionId,state)
 }
 return result
}
export function readFocus(value:unknown):FocusSession|null{
 if(value==null)return null
 const s=value as FocusSession
 if(s.version!==1||typeof s.id!=='string'||!/^focus:[A-Za-z0-9:_-]{1,100}$/.test(s.id)||!Array.isArray(s.items)||!s.items.length||s.items.length>40000||s.snapshot!==sourceFactKey(JSON.stringify(s.items))||s.items.some(q=>!cleanChoices(q))||new Set(s.items.map(q=>q.id)).size!==s.items.length||
 !Array.isArray(s.queue)||s.queue.length>s.items.length*3||!Number.isSafeInteger(s.cursor)||s.cursor<0||s.cursor>s.queue.length||!Array.isArray(s.answers)||s.answers.length<s.cursor||s.answers.length>Math.min(s.queue.length,s.cursor+1)||typeof s.finished!=='boolean'||typeof s.stoppedEarly!=='boolean'||!Number.isFinite(s.startedAt)||!['normal','mistakes','retry'].includes(s.kind))throw Error('Invalid saved test')
 const queue=s.items.map((_,i)=>i),counts=new Map<number,number>()
 for(const[a,i]of s.answers.map((a,i)=>[a,i]as const)){
  const q=s.items[queue[i]]
  if(!q||a.item!==queue[i]||a.eventId!==s.id+':'+i||!Number.isFinite(a.time)||a.time<s.startedAt||!q.choices!.includes(a.choice)||a.correct!==checkStudyAnswer(q,a.choice))throw Error('Saved grading differs')
  const tries=(counts.get(a.item)??0)+1;counts.set(a.item,tries)
  if(s.kind==='mistakes'&&!a.correct&&tries<3)queue.push(a.item)
 }
 if(JSON.stringify(queue)!==JSON.stringify(s.queue)||s.stoppedEarly&&(!s.finished||s.kind!=='mistakes')||!s.stoppedEarly&&s.finished!==(s.cursor===s.queue.length))throw Error('Invalid saved position')
 return s
}
export const loadFocus=async()=>readFocus(await readStudyRecord(focusKey))
export const loadFocusHistory=async()=>((await readStudyRecord(historyKey))??[])as TestSummary[]
export const loadFocusArchives=async()=>((await readStudyRecord(archiveKey))??[])as FocusArchive[]
export async function startFocus(s:FocusSession,fromArchive=false){
 readFocus(s)
 const current=await loadFocus()
 if(current?.id===s.id){if(JSON.stringify(current)!==JSON.stringify(s))throw Error('A newer copy of this test is already current');return current}
 const keys=current?[focusKey,archiveKey,'focus-test:'+current.id]:[focusKey,archiveKey]
 if(fromArchive)keys.push('focus-test:'+s.id)
 await updateStudyRecords(keys,([old,index,...snapshots])=>{
  if(JSON.stringify(old)!==JSON.stringify(current))throw Error('Session changed in another tab')
  if(fromArchive&&JSON.stringify(snapshots.at(-1))!==JSON.stringify(s))throw Error('Archive changed in another tab')
  const archive=((index??[])as FocusArchive[]).filter(a=>a.id!==s.id)
  const next=current?[...archive.filter(a=>a.id!==current.id),{id:current.id,time:current.startedAt,finished:current.finished}]:archive
  return[s,next,...(current?[old]:[])]
 })
 return s
}
export async function resumeFocus(id:string){
 const current=await loadFocus();if(current?.id===id)return current
 const archived=await loadPastFocus(id)
 if(!archived||archived.finished)throw Error('No unfinished test')
 return startFocus(archived,true)
}
export async function answerFocus(id:string,cursor:number,choice:string){
 const eventKey = answerLogPrefix + id + ':' + cursor
 const [session,event] = await updateStudyRecords([focusKey,eventKey],([raw,saved])=>{
  const s=readFocus(raw)
  if(!s||s.id!==id||s.cursor!==cursor||s.finished)throw Error('Session changed')
  if(s.answers.length>s.cursor)return[s,saved]
  if(saved)throw Error('Answer already recorded')
  const next=markFocusAnswer(s,choice),a=next.answers.at(-1)!,q=next.items[a.item]
  const event=makeStudyEvent(q,a.correct?'correct':'incorrect',a.eventId,a.choice,{
   sessionId:s.id,optionIndex:q.choices!.indexOf(choice),skill:q.skill,time:a.time,
  })
  return[next,event]
 })
 return{session:session as FocusSession,event:event as StudyEvent|null}
}
export async function advanceFocus(id:string,cursor:number,stop=false){
 const [session,history]=await updateStudyRecords([focusKey,historyKey],([raw,summaries])=>{
  const s=readFocus(raw);if(!s||s.id!==id||s.cursor!==cursor)throw Error('Session changed')
  const next=stop?{...s,finished:true,stoppedEarly:true}:nextFocusQuestion(s)
  const prior=(summaries??[])as TestSummary[]
  return[next,next.finished&&!prior.some(r=>r.id===id)?[...prior,summarizeFocus(next)]:prior]
 })
 return{session:session as FocusSession,history:history as TestSummary[]}
}
export const loadPastFocus=async(id:string)=>readFocus(await readStudyRecord('focus-test:'+id))
