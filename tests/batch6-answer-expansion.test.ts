import {readFileSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {describe,it,expect} from 'vitest'
import {validateEducationPackage} from '../src/education-package'
import {validateAnswerProvenance} from '../src/official-answers'
import {feedbackExamples} from '../src/pilot'
import {checkStudyAnswer} from '../src/study-engine'
import {availableStudyQuestions} from '../src/source-questions'
import {fromStudyQuestion,eligiblePractice,loadPracticePreferences,questionGroups} from '../src/practice'
import {adaptiveRound,buildEvidence} from '../src/learning-model'
import {preparePersonalQuiz} from '../src/personal-quiz'
import {makeQuiz,germanKey,isCorrect,modes} from '../src/quiz'
import type {ChapterKey} from '../src/source-data'
const file=process.env.GERMAN_QUIZ_BATCH6_FINAL,base=process.env.GERMAN_QUIZ_BATCH6_BASELINE
describe.runIf(Boolean(file&&base))('real cumulative batch six',()=>{
 const raw=file?JSON.parse(readFileSync(file,'utf8')):null
 const data:ReturnType<typeof validateEducationPackage>|null=raw?validateEducationPackage(raw):null
 const previous=base?validateEducationPackage(JSON.parse(readFileSync(base,'utf8'))):null
 const fresh=data?.study.questions.slice(previous?.study.questions.length??0)??[]
 it('preserves every prior question, lesson, source, identity and review state',()=>{
  expect(data!.study.questions.slice(0,previous!.study.questions.length)).toEqual(previous!.study.questions)
  expect(data!.study.lessons.slice(0,previous!.study.lessons.length)).toEqual(previous!.study.lessons)
  expect(data!.study.sources).toEqual(previous!.study.sources)
  expect(data!.study.chapters).toEqual(previous!.study.chapters)
  for(const old of previous!.vocabulary.entries){
   const entry=data!.vocabulary.entries.find(e=>e.id===old.id)!
   expect({...entry,examples:old.examples,incompleteExampleLevels:old.incompleteExampleLevels}).toEqual(old)
   expect(entry.examples.slice(0,old.examples.length)).toEqual(old.examples)
  }
 })
 it('accounts for the actual additions without inflating canonical words with contextual cards',()=>{
  expect(data!.vocabulary.entries).toHaveLength(1601)
  expect(data!.study.questions).toHaveLength(4080)
  expect(data!.study.lessons).toHaveLength(220)
  expect(data!.study.readingPassages).toHaveLength(163)
  expect(fresh).toHaveLength(210)
  expect(new Set(data!.study.questions.map(q=>q.id)).size).toBe(4080)
 })
 it('matches 137 new answer facts separately from indexed candidate blocks',()=>{
  const official=fresh.filter(q=>q.answerVerification?.status==='official_answer')
  expect(official).toHaveLength(137)
  for(const q of official){expect(q.answerVerification?.humanVerified).toBe(false)
   expect(q.answerVerification?.questionLocation.document).toBe('a2-book')
   expect(q.answerVerification?.official?.recordId).toContain('a2-solutions:'+q.chapter.split(':')[1]+':')
  }
  expect(fresh.filter(q=>q.answerVerification?.status==='ai_derived_verified')).toHaveLength(0)
 })
 it('accepts all recorded alternatives and only one presented multiple-choice answer',()=>{
  expect(fresh.some(q=>q.answers.length>1)).toBe(true)
  for(const q of fresh){for(const answer of q.answers)expect(checkStudyAnswer(q,answer)).toBe(true)
   expect(checkStudyAnswer(q,'invalid-999')).toBe(false)
   if(q.choices)expect(q.choices.filter(answer=>checkStudyAnswer(q,answer))).toHaveLength(1)
  }
 })
 it('retains raw split words and rejects edits that change characters or lack evidence',()=>{
  const target=data!.study.questions.find(q=>q.answerVerification?.official?.wordJoins?.length)!
  expect(target.answerVerification?.official?.rawAnswer).toContain('ver\nstehen')
  expect(()=>validateAnswerProvenance(data!.study)).not.toThrow()
  for(const mode of ['change','absent','missing']){
   const changed=structuredClone(data!.study),official=changed.questions.find(q=>q.id===target.id)!.answerVerification!.official!
   if(mode==='change')official.wordJoins![0].joined='invented'
   if(mode==='absent')official.wordJoins![0].original='not\nprinted'
   if(mode==='missing')delete official.wordJoins
   expect(()=>validateAnswerProvenance(changed)).toThrow()
  }
 })
 it('fills the 30 previous and 26 new example gaps without human approval claims',()=>{
  const batch=raw.contentEngineering.exampleBatches.at(-1)
  expect(batch.examples).toHaveLength(56)
  expect(batch.examples.filter((e:any)=>e.source_type==='source_pdf')).toHaveLength(43)
  expect(batch.examples.filter((e:any)=>e.source_type==='generated')).toHaveLength(13)
  for(const item of batch.examples){const entry=data!.vocabulary.entries.find(e=>e.id===item.entryId)!
   expect(feedbackExamples(entry.examples,'A2').some(e=>Boolean(e.arabic))).toBe(true)
   expect(item.humanVerified).toBe(false)
   expect(entry.examples[0].verificationStatus).not.toBe('human_verified')
  }
  expect(data!.vocabulary.entries.filter(e=>!feedbackExamples(e.examples,'A2').length)).toHaveLength(0)
 })
 it('restores seven printed reflexive lemmas without changing IDs, raw cells or review states',()=>{
  const ledger=raw.contentEngineering.reflexiveLemmaCorrections
  expect(ledger.corrections).toHaveLength(7)
  for(const item of ledger.corrections){
   const entry=data!.vocabulary.entries.find(e=>e.id===item.entryId)!
   const row=data!.vocabulary.sourceRows!.find(r=>r.id===item.rowId)!
   expect(entry.german).toBe('sich '+item.before)
   expect(row.german).toBe(entry.german)
   expect(row.raw_cells).toContain(item.before)
   expect(entry.vocabularyStatus).toBe('automatically_validated')
   expect(item.humanVerified).toBe(false)
  }
 })
 it('retains complete page inventories, explicit exclusions and row-shaped tables',()=>{
  for(const n of [5,6,7,8]){
   const folder=join(dirname(file!),'A2-'+n),curation=JSON.parse(readFileSync(join(folder,'curation.json'),'utf8'))
   const inventory=JSON.parse(readFileSync(join(folder,'layout/page-inventory.json'),'utf8'))
   for(const page of inventory)expect(curation.coverage.some((r:any)=>(r.document??'a2-book')===page.document&&[r.page,...(r.pages??[])].includes(page.page))).toBe(true)
   expect(curation.coverage.some((r:any)=>r.status==='excluded'&&r.reason)).toBe(true)
   for(const table of curation.tables)for(const row of table.rows)expect(row.length).toBe(table.columns.length)
  }
 })
 it('runs 512 seeded rounds on both reliability modes and three level scopes',()=>{
  const preferences=loadPracticePreferences(null,null)
  const pools=[false,true].map(expanded=>availableStudyQuestions(data!.study.questions,data!.vocabulary.entries,expanded,data!.vocabulary.questionExclusions).map(fromStudyQuestion))
  const scenarios=[false,true].flatMap((expanded,index)=>['A1','A2','all'].map(scope=>{
   const chapters=data!.study.chapters.filter(c=>scope==='all'||c.id.startsWith(scope+':')).map(c=>c.id as ChapterKey)
   return{chapters,groups:questionGroups(eligiblePractice(pools[index],chapters,preferences,new Set(),new Map()))}
  }))
  for(let seed=0;seed<512;seed++){
   const {chapters,groups}=scenarios[(seed%2)*3+seed%3]
   const count=[10,20,30,50][seed%4] as 10|20|30|50
   const round=adaptiveRound(groups,count,buildEvidence([]),1700000000000,seed)
   expect(round).toHaveLength(count);expect(new Set(round.map(q=>q.key)).size).toBe(count)
   expect(round.every(q=>chapters.some(ch=>ch===q.chapter))).toBe(true)
   expect(round.some(q=>q.activity==='writing')).toBe(false)
  }
 })
 it('checks 512 final vocabulary rounds, all five modes, safe distractors and unique headwords',async()=>{
  const bank=await preparePersonalQuiz(data!.vocabulary)
  const catalogs=[bank.catalogs.A1,bank.catalogs.A2,bank.getExpandedCatalog('A1'),bank.getExpandedCatalog('A2')]
  const seenModes=new Set<string>()
  for(let seed=0;seed<512;seed++){
   let state=seed+1
   const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32}
   const catalog=catalogs[seed%4],count=[10,20,30,50][Math.floor(seed/4)%4] as 10|20|30|50
   const round=makeQuiz(catalog,random,count)
   expect(round).toHaveLength(Math.min(count,catalog.entryCount))
   expect(new Set(round.map(q=>germanKey(q.entry.german))).size).toBe(round.length)
   for(const q of round){
    seenModes.add(q.mode)
    expect(q.choices.filter(c=>isCorrect(q,c.id))).toHaveLength(1)
    expect(new Set(q.choices.map(c=>c.text)).size).toBe(q.choices.length)
    if(q.mode==='article')expect(q.choices).toHaveLength(3)
    const fact=catalog.facts.get(q.id)!
    if(q.mode!=='article'&&!fact.optionCount){
     expect(q.choices).toHaveLength(4)
     for(const [index,choice]of q.choices.entries())for(const other of q.choices.slice(index+1))expect(catalog.compatible(choice.id,other.id)).toBe(true)
    }
   }
  }
  expect(modes.every(mode=>seenModes.has(mode))).toBe(true)
 },20000)
})
