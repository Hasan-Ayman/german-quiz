import {readFileSync} from 'node:fs'
import {describe,it,expect} from 'vitest'
import {cleanChoices,buildLearningLibrary,balancedSelection,type LearningItem} from '../src/learning-library'
import {newFocusSession,markFocusAnswer,nextFocusQuestion,readFocus,retryFocus,focusMistakes,mistakeMastery} from '../src/focus-session'
import {checkStudyAnswer} from '../src/study-engine'
import {fromStudyQuestion} from '../src/practice'
import {buildEvidence} from '../src/learning-model'
import type {StudyQuestion} from '../src/study-content'
import {makeStudyEvent,type StudyEvent} from '../src/study-progress'
import {preparePersonalQuiz} from '../src/personal-quiz'
import {validateEducationPackage} from '../src/education-package'

const q=(id='sample'):StudyQuestion=>({id,chapter:'A1:1',type:'grammar',topic:'',origin:'authored',verification:'editorial_checked',source:{document:'a1-book',page:7},prompt:'Testfrage',instruction:'اختبار',answers:['richtig'],choices:['falsch','richtig','anders'],explanation:'شرح تجريبي',german:'Test',arabic:'اختبار'})
const item=(id:string):LearningItem=>{const view=q(id);return{...fromStudyQuestion(view),key:id,view,multipleChoice:true}}
const event=(result:StudyEvent['result'],n:number,id='sample'):StudyEvent=>({id:'event:'+n,questionId:id,chapter:'A1:1',topic:'',type:'grammar',time:100+n,result})
it('admits only distinct choices with exactly one accepted answer, never typed or open-ended activities',()=>{
 expect(cleanChoices(q())).toBe(true)
 for(const bad of [{choices:undefined},{choices:['richtig','richtig']},{answers:['richtig','falsch']},{choices:['anders','falsch']},{type:'writing'},{type:'order'},{errorIndex:0}] as Partial<StudyQuestion>[])expect(cleanChoices({...q(),...bad})).toBe(false)
 expect(cleanChoices({...q(),type:'reading',answers:['أَدَاة'],choices:['اداة','أداة؟']})).toBe(false)
})
it.each([10,20,30,50,'all']as const)('respects count %s and never repeats a semantic group',count=>{
 const pool=Array.from({length:60},(_,i)=>item('q'+i));pool.push({...pool[0],id:'duplicate',chapter:'A2:1'})
 const selected=balancedSelection(pool,count,new Map(),1000,42)
 expect(selected.length).toBe(count==='all'?60:count)
 expect(new Set(selected.map(i=>i.key)).size).toBe(selected.length)
 expect(selected.map(i=>i.id)).toEqual(balancedSelection(pool,count,new Map(),1000,42).map(i=>i.id))
})
it('uses only the actual available questions and accepts an empty pool safely',()=>{
 expect(balancedSelection([item('one')],50,new Map(),1000,5)).toHaveLength(1)
 expect(balancedSelection([],10,new Map(),1000,5)).toEqual([])
})
it('includes due, weak, unseen and retention candidates',()=>{
 const rows=[event('incorrect',1,'due'),event('incorrect',2,'weak'),event('correct',3,'retention')]
 const evidence=buildEvidence(rows);evidence.get('due')!.due=999;evidence.get('weak')!.due=2000;evidence.get('retention')!.due=2000
 expect(new Set(balancedSelection(['due','weak','new','retention'].map(item),10,evidence,1000,1).map(i=>i.id))).toEqual(new Set(['due','weak','new','retention']))
})
it('locks the answer, preserves the frozen sequence and requires manual Next',()=>{
 const original=newFocusSession([q('one'),q('two')],'normal','focus:one',10)
 const answered=markFocusAnswer(original,'falsch',20)
 expect(answered.cursor).toBe(0);expect(answered.finished).toBe(false)
 expect(markFocusAnswer(answered,'richtig',30)).toBe(answered)
 expect(nextFocusQuestion(original)).toBe(original)
 expect(readFocus(JSON.parse(JSON.stringify(answered)))).toEqual(answered)
 expect(nextFocusQuestion(answered).cursor).toBe(1)
 expect(()=>readFocus({...answered,items:[{...q('one'),answers:['falsch']},q('two')]})).toThrow()
 expect(()=>readFocus({...answered,queue:[1,0]})).toThrow()
 expect(()=>readFocus({...answered,answers:[{...answered.answers[0],correct:true}]})).toThrow()
})
it('bounds wrong-answer review to three attempts and retries the exact tested facts',()=>{
 let s=newFocusSession([q()],'mistakes','focus:review',10)
 for(let i=0;i<3;i++){s=markFocusAnswer(s,'falsch',20+i);expect(readFocus(s)).toEqual(s);s=nextFocusQuestion(s)}
 expect(s.finished).toBe(true);expect(s.queue).toEqual([0,0,0]);expect(s.answers).toHaveLength(3)
 expect(focusMistakes(s)).toHaveLength(1)
 const retry=retryFocus(s,'focus:retry',()=>0)
 expect(retry.items[0].answers).toEqual(s.items[0].answers)
 expect(retry.items[0].id).toBe(s.items[0].id)
 expect(new Set(retry.items[0].choices)).toEqual(new Set(s.items[0].choices))
 expect(retry.items[0].choices).not.toEqual(s.items[0].choices)
})
it('requires two actual consecutive correct attempts, deduplicates events and reopens new mistakes',()=>{
 const wrong=event('incorrect',1),right=event('correct',2),right2=event('correct',3)
 expect(mistakeMastery([wrong,right]).get('sample')).toMatchObject({active:true,streak:1})
 expect(mistakeMastery([wrong,right,right]).get('sample')).toMatchObject({active:true,streak:1})
 expect(mistakeMastery([wrong,right,event('known',4),event('completed',5)]).get('sample')?.streak).toBe(1)
 expect(mistakeMastery([wrong,right,right2]).get('sample')).toMatchObject({active:false,streak:2})
 expect(mistakeMastery([wrong,right,right2,event('incorrect',4)]).get('sample')).toMatchObject({active:true,streak:0})
 expect(mistakeMastery([wrong,right,event('incorrect',3),event('correct',4)]).get('sample')).toMatchObject({active:true,streak:1})
 expect(mistakeMastery([],['legacy']).get('legacy')).toMatchObject({active:true,streak:0})
})

const file=process.env.GERMAN_QUIZ_FINAL_UI_FILE,base=process.env.GERMAN_QUIZ_FINAL_UI_BASE
describe.runIf(Boolean(file&&base))('actual complete private library',()=>{
 it('preserves all original records and explanations and validates 500 seeded mixed rounds',async()=>{
  const original=JSON.parse(readFileSync(base!,'utf8')),enriched=validateEducationPackage(JSON.parse(readFileSync(file!,'utf8')))
  expect(enriched.vocabulary).toEqual(original.vocabulary);expect(enriched.study).toEqual(original.study)
  const bank=await preparePersonalQuiz(enriched.vocabulary),expanded=buildLearningLibrary(bank,enriched.study,true,enriched.explanations)
  expect(enriched.vocabulary.entries).toHaveLength(1635);expect(enriched.study.chapters).toHaveLength(24)
  expect(expanded.items.every(i=>i.view.explanation)).toBe(true)
  const byOriginalId=new Map(original.study.questions.map((q:StudyQuestion)=>[q.id,q]))
  for(const i of expanded.items){const old=byOriginalId.get(i.id) as StudyQuestion|undefined;if(old?.explanation)expect(i.view.explanation).toBe(old.explanation)}
  for(const mode of [false,true]){
   const library=mode?expanded:buildLearningLibrary(bank,enriched.study,false,enriched.explanations)
   expect(library.items.every(i=>i.view.explanation)).toBe(true)
   for(const level of ['A1','A2']){
    const chapters=library.chapters.filter(c=>c.level===level).map(c=>c.id)
    expect(chapters).toHaveLength(12)
    for(const chosen of [[chapters[0]],[chapters[0],chapters[2],chapters[6]],chapters,[]]){
     const pool=chosen.flatMap(c=>library.byChapter.get(c)!).filter(i=>i.multipleChoice)
     const all=balancedSelection(pool,'all',new Map(),1000,8)
     expect(all.every(i=>chosen.includes(i.chapter as never))).toBe(true)
     expect(all.every(i=>i.chapter.startsWith(level+':'))).toBe(true)
     expect(new Set(all.map(i=>i.key)).size).toBe(all.length)
    }
    const pool=library.multipleChoice.filter(i=>i.chapter.startsWith(level+':'))
    for(let seed=0;seed<125;seed++){
     const count=([10,20,30,50]as const)[seed%4],round=balancedSelection(pool,count,new Map(),1000,seed)
     expect(round).toHaveLength(count);expect(new Set(round.map(i=>i.key)).size).toBe(count)
     for(const i of round){const question=i.make(()=>.37);expect(cleanChoices(question)).toBe(true);expect(()=>makeStudyEvent(question,'correct','test:event',question.answers[0])).not.toThrow();expect(question.choices!.filter(c=>checkStudyAnswer(question,c))).toHaveLength(1)}
    }
   }
  }
  // Stale supplements must never replace an approved explanation or bind to a changed fact.
  const record=enriched.explanations!.records[0]
  const corrupt={...enriched,explanations:{version:1,records:[{...record,text:'لا توجد أحرف تالفة',verification:'human_verified'}]}}
  expect(()=>validateEducationPackage(corrupt)).toThrow()
 },120000)
})
