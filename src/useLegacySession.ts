import {useEffect,useRef,useState,type SetStateAction} from 'react'
import type {PersonalQuiz} from './personal-quiz'
import type {Attempt} from './quiz'
import {readLocal} from './storage'
import {freezeSession,loadLegacySession,saveLegacySession,type FrozenSession} from './legacy-session'

export function useLegacySession(bank: PersonalQuiz | null, readOnly=false) {
  const [session,setSession]=useState<FrozenSession|null>(null)
  const [sessions,setSessions]=useState<FrozenSession[]>([])
  const [loading,setLoading]=useState(true)
  const [issue,setIssue]=useState('')
  const generation=useRef(0)
  useEffect(()=>{
    let active=true
    async function load(){
      const current=++generation.current;setLoading(true)
      try{
        const result=bank?await loadLegacySession(bank,readLocal('attempt')):null
        if(active&&current===generation.current){setSession(result?.session??null);setSessions(result?.archive.sessions??[]);setIssue(result?.issue??'')}
      }catch{if(active)setIssue('تعذّر فتح جلسات الاختبار المحفوظة. بقيت بياناتك محفوظة؛ أعد فتح التطبيق وحاول مجددًا.')}
      finally{if(active&&current===generation.current)setLoading(false)}
    }
    void load()
    if(readOnly)window.addEventListener('german-quiz:legacy-session',load)
    return()=>{active=false;if(readOnly)window.removeEventListener('german-quiz:legacy-session',load)}
  },[bank,readOnly])
  useEffect(()=>{
    if(readOnly||loading||!session)return
    let active=true
    void saveLegacySession(session).then(()=>{if(active)window.dispatchEvent(new Event('german-quiz:legacy-session'))})
      .catch(()=>{if(active)setIssue('تعذّر حفظ تقدّم الاختبار. لم يُحذف السجل السابق. اترك الصفحة مفتوحة وحاول مجددًا.')})
    return()=>{active=false}
  },[session,loading,readOnly])
  const setAttempt=(next: SetStateAction<Attempt|null>)=>{
    const submittedAt=Date.now()
    setSession(previous=>{
    const attempt=typeof next==='function'?next(previous?.attempt??null):next
    if(!attempt)return null
    const continuing=previous?.attempt.questions===attempt.questions
    const answerTimes=attempt.answers.map((_,index)=>continuing&&index<previous.attempt.answers.length
      ? previous.answerTimes?.[index]??null : submittedAt)
    return freezeSession(attempt,previous&&(continuing||attempt.kind==='retry')?previous.revision:bank!.revision,
      continuing?previous.id:crypto.randomUUID(),answerTimes)
    })
  }
  return {snapshot:session,attempt:session?.attempt??null,setAttempt,loading,issue,sessions,historical:Boolean(session&&bank&&session.revision!==bank.revision)}
}
