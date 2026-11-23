import {describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import {validateAnswerProvenance} from '../src/official-answers'
import {validateEducationPackage} from '../src/education-package'
import {checkStudyAnswer} from '../src/study-engine'
import {availableStudyQuestions} from '../src/source-questions'
import {fromStudyQuestion,eligiblePractice,loadPracticePreferences,questionGroups} from '../src/practice'
import {adaptiveRound,buildEvidence} from '../src/learning-model'
import type {ChapterKey} from '../src/source-data'
// @ts-expect-error The extraction helper is JavaScript, outside the app bundle.
import {alignedRows} from '../scripts/source_layout/aligned_rows.mjs'
const file=process.env.GERMAN_QUIZ_BATCH5_FINAL
const base=process.env.GERMAN_QUIZ_BATCH5_BASELINE
describe('coordinate table reconstruction',()=>{
 it('retains the last borderless row and isolates columns',()=>{
  expect(alignedRows([{text:'alpha',x0:1,top:10},{text:'beta',x0:22,top:10},{text:'last',x0:22,top:30}],
   [{top:10},{top:30}],[[0,20],[20,40]])).toEqual([['alpha','beta'],['','last']])
 })
 it('does not consume the following row or a distant heading',()=>{
  expect(alignedRows([{text:'row',x0:5,top:10},{text:'heading',x0:5,top:50}], [{top:10}],[[0,20]])).toEqual([['row']])
 })
})
describe.runIf(Boolean(file&&base))('private official-booklet and cumulative checkpoint',()=>{
 const data=file?validateEducationPackage(JSON.parse(readFileSync(file,'utf8'))):null
 const old=base?validateEducationPackage(JSON.parse(readFileSync(base,'utf8'))):null
  const study=(data?.study)!
 it('imports the real complete package and preserves prior content and all original examples',()=>{
  expect(data!.vocabulary.entries).toHaveLength(1575)
  expect(study.questions.slice(0,old!.study.questions.length)).toEqual(old!.study.questions)
  expect(study.lessons.slice(0,old!.study.lessons.length)).toEqual(old!.study.lessons)
  for(const entry of old!.vocabulary.entries){
   const fresh=data!.vocabulary.entries.find(e=>e.id===entry.id)!
   expect(fresh.examples.slice(0,entry.examples.length)).toEqual(entry.examples)
   expect(fresh.vocabularyStatus).toEqual(entry.vocabularyStatus)
   expect(fresh.sources).toEqual(entry.sources)
  }
 })
 it('keeps 52 official mappings separate from 14 AI-derived solutions',()=>{
  expect(study.questions.filter(q=>q.answerVerification?.status==='official_answer')).toHaveLength(52)
  expect(study.questions.filter(q=>q.answerVerification?.status==='ai_derived_verified')).toHaveLength(14)
  expect(()=>validateAnswerProvenance(study)).not.toThrow()
  const legacy=structuredClone(old!.study);expect(()=>validateAnswerProvenance(legacy)).not.toThrow()
 })
 it('rejects wrong booklet, chapter, section, model answers and invented accepted alternatives',()=>{
  for(const mutate of [
   (q:any)=>q.answerVerification.official.sha256='0'.repeat(64),
   (q:any)=>q.chapter='A1:1',
   (q:any)=>q.answerVerification.questionLocation.section='Abschlusstest',
   (q:any)=>q.answerVerification.official.page=33,
   (q:any)=>q.answerVerification.official.exampleAnswer=true,
   (q:any)=>q.answers.push('unsupported-999'),
  ]){const changed=structuredClone(study);mutate(changed.questions.find(q=>q.answerVerification?.status==='official_answer'));expect(()=>validateAnswerProvenance(changed)).toThrow()}
 })
 it('rejects a mismatched transcript, preserving 18 explicitly textual reading units',()=>{
  expect(study.readingPassages?.filter(p=>p.transcriptEvidence)).toHaveLength(18)
  const changed=structuredClone(study)
  changed.questions.find(q=>q.transcriptEvidence)!.transcriptEvidence!.sha256='0'.repeat(64)
  expect(()=>validateAnswerProvenance(changed)).toThrow()
  for(const q of study.questions.filter(q=>q.transcriptEvidence))expect(q.contentBasis).toBe('transcript_based_reading')
 })
 it('checks every new answer and rejects ambiguous multiple-choice keys',()=>{
  const fresh=study.questions.slice(old!.study.questions.length)
  expect(fresh).toHaveLength(155)
  for(const q of fresh){for(const a of q.answers)expect(checkStudyAnswer(q,a)).toBe(true)
   expect(checkStudyAnswer(q,'invalid-999')).toBe(false)
   if(q.choices)expect(q.choices.filter(c=>checkStudyAnswer(q,c))).toHaveLength(1)
  }
 })
 it('separately records 68 AI-reviewed bilingual additions and honest remaining gaps',()=>{
  const batches=(data as any).contentEngineering.exampleBatches
  expect(batches.flatMap((b:any)=>b.examples)).toHaveLength(68)
  expect(batches[0].examples.filter((e:any)=>e.source_type==='source_pdf')).toHaveLength(24)
  expect(batches[0].examples.filter((e:any)=>e.source_type==='generated')).toHaveLength(44)
  for(const item of batches[0].examples){const e=data!.vocabulary.entries.find(e=>e.id===item.entryId)!
   expect(e.examples).toHaveLength(1);expect(e.examples[0].arabic).toMatch(/\p{Script=Arabic}/u)
   expect(item.humanVerified).toBe(false);expect(e.examples[0].verificationStatus).not.toBe('human_verified')
  }
  const newEntries=data!.vocabulary.entries.slice(old!.vocabulary.entries.length)
  expect(newEntries).toHaveLength(30);expect(newEntries.every(e=>!e.examples.length)).toBe(true)
 })
 it('runs 512 seeded rounds on the final pool with valid keys and chapter attribution',()=>{
  const pool=availableStudyQuestions(study.questions,data!.vocabulary.entries,true,data!.vocabulary.questionExclusions).map(fromStudyQuestion)
  const prefs=loadPracticePreferences(null,null)
  for(let seed=0;seed<512;seed++){
   const level=['A1','A2','all'][seed%3]
   const chapters=study.chapters.filter(c=>level==='all'||c.id.startsWith(level+':')).map(c=>c.id as ChapterKey)
   const eligible=eligiblePractice(pool,chapters,prefs,new Set(),new Map())
   const count=[10,20,30,50][seed%4] as 10|20|30|50
   const round=adaptiveRound(questionGroups(eligible),count,buildEvidence([]),1700000000000,seed)
   expect(round).toHaveLength(count);expect(new Set(round.map(q=>q.key)).size).toBe(count)
   expect(round.every(q=>chapters.some(ch=>ch===q.chapter))).toBe(true)
   expect(round.some(q=>q.activity==='writing')).toBe(false)
  }
 })
})
