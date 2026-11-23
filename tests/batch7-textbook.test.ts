import {readFileSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {describe,it,expect} from 'vitest'
import {validateEducationPackage} from '../src/education-package'
import {feedbackExamples} from '../src/pilot'
import {checkStudyAnswer} from '../src/study-engine'
import {availableStudyQuestions} from '../src/source-questions'
import {fromStudyQuestion,eligiblePractice,loadPracticePreferences,questionGroups} from '../src/practice'
import {adaptiveRound,buildEvidence} from '../src/learning-model'
import {preparePersonalQuiz} from '../src/personal-quiz'
import {makeQuiz,germanKey,isCorrect,modes} from '../src/quiz'
import type {ChapterKey} from '../src/source-data'
const file=process.env.GERMAN_QUIZ_BATCH7_FINAL,base=process.env.GERMAN_QUIZ_BATCH7_BASELINE
describe.runIf(Boolean(file&&base))('final private textbook batch',()=>{
 const raw=file?JSON.parse(readFileSync(file,'utf8')):null
 const data=(raw?validateEducationPackage(raw):null)!
 const previous=(base?validateEducationPackage(JSON.parse(readFileSync(base,'utf8'))):null)!
 const fresh=data?.study.questions.slice(previous?.study.questions.length??0)??[]
 it('preserves prior records, examples, review states, questions and grading',()=>{
  expect(data.vocabulary.entries.slice(0,previous.vocabulary.entries.length)).toEqual(previous.vocabulary.entries)
  expect(data.vocabulary.sourceRows!.slice(0,previous.vocabulary.sourceRows!.length)).toEqual(previous.vocabulary.sourceRows)
  expect(data.study.questions.slice(0,previous.study.questions.length)).toEqual(previous.study.questions)
  expect(data.study.lessons.slice(0,previous.study.lessons.length)).toEqual(previous.study.lessons)
  expect(data.study.readingPassages!.slice(0,previous.study.readingPassages!.length)).toEqual(previous.study.readingPassages)
  expect(data.study.chapters).toEqual(previous.study.chapters)
  expect(previous.vocabulary.entries.flatMap(e=>e.examples)).toHaveLength(1808)
 })
 it('counts actual additions and preserves stable unique identities',()=>{
  expect(data.vocabulary.entries).toHaveLength(1635)
  expect(data.study.questions).toHaveLength(4217)
  expect(data.study.lessons).toHaveLength(236)
  expect(data.study.readingPassages).toHaveLength(184)
  expect(fresh).toHaveLength(137)
  expect(new Set(data.vocabulary.entries.map(e=>e.id)).size).toBe(data.vocabulary.entries.length)
  expect(new Set(data.study.questions.map(q=>q.id)).size).toBe(data.study.questions.length)
 })
 it('separates official matches, recovery and derived reading questions',()=>{
  const official=fresh.filter(q=>q.answerVerification?.status==='official_answer')
  expect(official).toHaveLength(114)
  expect(official.filter(q=>Number(q.chapter.split(':')[1])<9)).toHaveLength(12)
  expect(fresh.filter(q=>q.answerVerification?.status==='ai_derived_verified')).toHaveLength(0)
  for(const q of official){const proof=q.answerVerification!
   expect(proof.humanVerified).toBe(false)
   expect(proof.official!.recordId).toBe(`a2-solutions:${q.chapter.split(':')[1]}:${proof.questionLocation.section}:${proof.questionLocation.exercise}`)
  }
 })
 it('grades every alternative and has exactly one correct displayed choice',()=>{
  for(const q of fresh){for(const answer of q.answers)expect(checkStudyAnswer(q,answer)).toBe(true)
   expect(checkStudyAnswer(q,'invalid 999')).toBe(false)
   if(q.choices)expect(q.choices.filter(c=>checkStudyAnswer(q,c))).toHaveLength(1)
   expect(q.explanation).toMatch(/\p{Script=Arabic}/u)
   if(q.passageRef)expect(data.study.readingPassages!.find(p=>p.id===q.passageRef)!.german).toContain(q.readingEvidence)
  }
 })
 it('uses 34 original examples with authored Arabic and no new human claims',()=>{
  const batch=raw.contentEngineering.exampleBatches.at(-1)
  expect(batch.examples).toHaveLength(34)
  for(const item of batch.examples){
   expect(item.source_type).toBe('source_pdf');expect(item.humanVerified).toBe(false)
   const entry=data.vocabulary.entries.find(e=>e.id===item.entryId)!
   expect(entry.vocabularyStatus).toBe('automatically_validated')
   expect(entry.examples[0].origin).toBe('source_pdf')
   if(entry.examples[0].origin==='source_pdf')expect(entry.examples[0].arabicOrigin).toBe('authored')
   expect(entry.examples[0].verificationStatus).not.toBe('human_verified')
   expect(feedbackExamples(entry.examples,'A2').some(e=>Boolean(e.arabic))).toBe(true)
  }
  expect(data.vocabulary.entries.flatMap(e=>e.examples)).toHaveLength(1842)
  expect(data.vocabulary.entries.filter(e=>!feedbackExamples(e.examples,'A2').some(x=>Boolean(x.arabic)))).toHaveLength(0)
 })
 it('accounts for all textbook pages without processing the teacher vocabulary PDFs',()=>{
  for(const n of [9,10,11,12]){
   const dir=join(dirname(file!),'A2-'+n)
   const inventory=JSON.parse(readFileSync(join(dir,'layout/page-inventory.json'),'utf8'))
   const c=JSON.parse(readFileSync(join(dir,'curation.json'),'utf8'))
   const ch=data.study.chapters.find(c=>c.id==='A2:'+n)!
   expect(inventory).toHaveLength(ch.endPage-ch.startPage+1)
   expect(inventory.every((p:any)=>p.document==='a2-book')).toBe(true)
   expect(JSON.parse(readFileSync(join(dir,'layout/glossary-rows.json'),'utf8'))).toEqual([])
   for(const p of inventory)expect(c.coverage.some((r:any)=>r.document===p.document&&r.page===p.page)).toBe(true)
   expect(c.coverage.some((r:any)=>r.status==='excluded'&&r.reason)).toBe(true)
   for(const table of c.tables)for(const row of table.rows)expect(row.length).toBe(table.columns.length)
  }
 })
 it('keeps the identified source tense conflict inactive',()=>{
  expect(fresh.some(q=>q.chapter==='A2:12'&&q.answerVerification?.questionLocation.exercise==='T3'&&q.answerVerification.questionLocation.item==='3')).toBe(false)
 })
 it('constrains tense and receipt context without changing grading or old records',()=>{
  const ledger=raw.contentEngineering.questionPromptConstraints.at(-1)
  expect(ledger.corrections).toHaveLength(5)
  for(const c of ledger.corrections){
   expect(previous.study.questions.some(q=>q.id===c.questionId)).toBe(false)
   const q=data.study.questions.find(q=>q.id===c.questionId)!
   expect(q.prompt).toBe(c.after)
   expect(q.answerVerification!.questionLocation.rawQuestion).toBeTruthy()
   expect(q.answers).toEqual(q.answerVerification!.official!.acceptedAnswers)
   expect(data.study.sourceActivities!.find(a=>a.id===q.sourceActivityRef)!.question.prompt).toBe(c.after)
  }
  for(const q of fresh.filter(q=>q.chapter==='A2:10'&&q.answerVerification?.questionLocation.exercise==='12'))expect(q.prompt).toContain('Präsens')
 })
 it('runs 512 scoped rounds preserving counts, attribution and disabled writing',()=>{
  const prefs=loadPracticePreferences(null,null)
  const pools=[false,true].map(expanded=>availableStudyQuestions(data.study.questions,data.vocabulary.entries,expanded,data.vocabulary.questionExclusions).map(fromStudyQuestion))
  const scenarios=pools.flatMap(pool=>['A1','A2','all'].map(scope=>{
   const chapters=data.study.chapters.filter(c=>scope==='all'||c.id.startsWith(scope+':')).map(c=>c.id as ChapterKey)
   return{chapters,groups:questionGroups(eligiblePractice(pool,chapters,prefs,new Set(),new Map()))}
  }))
  for(let seed=0;seed<512;seed++){
   const {chapters,groups}=scenarios[seed%scenarios.length],count=[10,20,30,50][seed%4] as 10|20|30|50
   const round=adaptiveRound(groups,count,buildEvidence([]),1700000000000,seed)
   expect(round).toHaveLength(count);expect(new Set(round.map(q=>q.key)).size).toBe(count)
   expect(round.every(q=>chapters.some(ch=>ch===q.chapter))).toBe(true)
   expect(round.some(q=>q.activity==='writing')).toBe(false)
  }
 })
 it('runs 512 vocabulary rounds with unique headwords, safe distractors and all modes',async()=>{
  const bank=await preparePersonalQuiz(data.vocabulary),catalogs=[bank.catalogs.A1,bank.catalogs.A2,bank.getExpandedCatalog('A1'),bank.getExpandedCatalog('A2')],seen=new Set<string>()
  for(let seed=0;seed<512;seed++){
   let state=seed+1;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32}
   const catalog=catalogs[seed%4],count=[10,20,30,50][Math.floor(seed/4)%4] as 10|20|30|50,round=makeQuiz(catalog,random,count)
   expect(round).toHaveLength(Math.min(count,catalog.entryCount))
   expect(new Set(round.map(q=>germanKey(q.entry.german))).size).toBe(round.length)
   for(const q of round){seen.add(q.mode);expect(q.choices.filter(c=>isCorrect(q,c.id))).toHaveLength(1)
    if(q.mode==='article')expect(q.choices).toHaveLength(3)
    else if(!catalog.facts.get(q.id)!.optionCount){expect(q.choices).toHaveLength(4)
     for(const[i,c]of q.choices.entries())for(const other of q.choices.slice(i+1))expect(catalog.compatible(c.id,other.id)).toBe(true)
    }
   }
  }
  expect(modes.every(m=>seen.has(m))).toBe(true)
 },20000)
})
