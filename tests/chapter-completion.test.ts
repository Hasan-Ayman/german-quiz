import { readFileSync } from 'node:fs'
import { dirname,join } from 'node:path'
import { describe,it,expect } from 'vitest'
import { validateEducationPackage } from '../src/education-package'
import { availableStudyQuestions } from '../src/source-questions'
import { preparePersonalQuiz } from '../src/personal-quiz'
import { checkStudyAnswer } from '../src/study-engine'
import { makeStudyEvent,mergeStudyProgress,reviewSchedule } from '../src/study-progress'
const file=process.env.GERMAN_QUIZ_CHAPTER1
describe.runIf(Boolean(file))('chapter one source completion',()=>{
 const raw=file&&JSON.parse(readFileSync(file,'utf8'))
 const base=file&&JSON.parse(readFileSync(join(dirname(file),'baseline.backup.json'),'utf8'))
 const content=raw&&validateEducationPackage(raw)
 it('preserves every old identity and confines additions to chapter one',()=>{
  const {questionExclusions,...unchanged}=content.vocabulary
  expect(unchanged).toEqual(base.vocabulary)
  expect(questionExclusions).toHaveLength(56)
  expect(content.study.chapters).toEqual(base.study.chapters)
  expect(content.study.questions.slice(0,base.study.questions.length)).toEqual(base.study.questions)
  expect(content.study.lessons.slice(0,base.study.lessons.length)).toEqual(base.study.lessons)
  expect(content.study.questions.slice(base.study.questions.length).every((q:{chapter:string})=>q.chapter==='A1:1')).toBe(true)
  expect(new Set(content.study.questions.map((q:{id:string})=>q.id)).size).toBe(content.study.questions.length)
 })
 it('requires evidence agreement and real chapter pages for new activities and lessons',()=>{
  for(const mutation of ['answer','reference','registry','lesson']){
   const invalid=structuredClone(raw)
   const q=invalid.study.questions.find((q:{sourceActivityRef?:string})=>q.sourceActivityRef)
   if(mutation==='answer')q.answers=['fabricated']
   if(mutation==='reference')q.source.page=276
   if(mutation==='registry')invalid.study.sourceActivities[0].humanVerified=true
   if(mutation==='lesson')invalid.study.lessons.at(-1).source.page=6
   expect(()=>validateEducationPackage(invalid)).toThrow()
  }
 })
 it('has one accepted choice and grades every added question in its declared language',()=>{
  for(const q of content.study.questions.slice(base.study.questions.length)){
   expect(checkStudyAnswer(q,q.answers[0])).toBe(true)
   expect(checkStudyAnswer(q,'WRONG 123')).toBe(false)
   if(q.choices)expect(q.choices.filter((choice:string)=>checkStudyAnswer(q,choice))).toHaveLength(1)
   if(q.tokens)expect(checkStudyAnswer(q,q.tokens.join(' '))).toBe(true)
   expect(q.type).not.toBe('writing')
  }
 })
 it('excludes printed approximate synonyms from chapter one without discarding the source text',async()=>{
  const bank=await preparePersonalQuiz(content.vocabulary)
  const facts=[...bank.getExpandedCatalog('A2').facts.values()]
  expect(facts.some(f=>f.mode.endsWith('-synonym')&&f.chapters?.includes('A1:1'))).toBe(false)
  expect(content.vocabulary.sourceRows.filter((r:{level:string;chapter_number:number;synonyms:string[]})=>r.level==='A1'&&r.chapter_number===1&&r.synonyms?.length)).toHaveLength(56)
 })
 it('keeps automatic vocabulary cards out of reviewed-only mode',()=>{
  const reviewed=availableStudyQuestions(content.study.questions,content.vocabulary.entries,false)
  const expanded=availableStudyQuestions(content.study.questions,content.vocabulary.entries,true)
  expect(reviewed.some(q=>q.sourceVocabularyReview==='automatically_validated')).toBe(false)
  expect(expanded.filter(q=>q.sourceVocabularyReview==='automatically_validated')).toHaveLength(65)
 })
 it('retains old review scheduling and accounts for every exercise with a disposition',()=>{
  const q=content.study.questions.find((q:{sourceActivityRef?:string;type:string})=>q.sourceActivityRef&&q.type==='cloze')
  const old=makeStudyEvent(base.study.questions[0],'incorrect','old-preserved','old response')
  const added=makeStudyEvent(q,'correct','new-source-response',q.answers[0])
  const merged=mergeStudyProgress([old],[added])
  expect(merged.find(e=>e.id===old.id)).toEqual(old)
  expect(reviewSchedule(merged).get(old.questionId)).toEqual(reviewSchedule([old]).get(old.questionId))
  const matrix=content.contentEngineering.chapter1Completion.coverage
  expect(matrix).toHaveLength(44)
  expect(matrix.every((r:{examined:boolean;extracted:boolean;unresolved:boolean;exclusion:string})=>r.examined&&r.extracted&&!r.unresolved&&r.exclusion)).toBe(true)
  for(let i=1;i<=23;i++)expect(matrix.some((r:{unit:string})=>r.unit===String(i))).toBe(true)
 })
})
