import {readFileSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {describe,it,expect} from 'vitest'
import {renderToStaticMarkup} from 'react-dom/server'
import {validateEducationPackage} from '../src/education-package'
import {preparePersonalQuiz} from '../src/personal-quiz'
import {vocabularyCandidates} from '../src/practice-vocabulary'
import {vocabularyFlashcards} from '../src/study-flashcards'
import {StudyExercise} from '../src/StudyExercise'
import {feedbackExamples} from '../src/pilot'
import {germanKey,makeQuiz} from '../src/quiz'
const file=process.env.GERMAN_QUIZ_REVIEW_SUPPLEMENT
const beforeFile=process.env.GERMAN_QUIZ_REVIEW_BEFORE
describe.runIf(Boolean(file&&beforeFile))('audited private source supplement',()=>{
const raw=JSON.parse(file?readFileSync(file,'utf8'):'null')
const data=(raw?validateEducationPackage(raw):null)!
const before=(beforeFile?validateEducationPackage(JSON.parse(readFileSync(beforeFile,'utf8'))):null)!
it('permits only the explicit source correction and example appends, preserving old raw evidence',()=>{
const ledger=raw.contentEngineering.reviewSupplement
expect(ledger.arabicCorrections).toHaveLength(1)
expect(ledger.newVocabulary).toHaveLength(31)
expect(ledger.humanVerified).toBe(false)
expect(data.study).toEqual(before.study)
for(let i=0;i<before.vocabulary.entries.length;i++){
 const a=data.vocabulary.entries[i],b=before.vocabulary.entries[i]
 expect(a.id).toBe(b.id);expect(a.examples.slice(0,b.examples.length)).toEqual(b.examples)
 const copy={...a,examples:b.examples,incompleteExampleLevels:b.incompleteExampleLevels}
 if(ledger.arabicCorrections.some((c:{rowId:string})=>before.vocabulary.sourceRows!.find(r=>r.id===c.rowId)?.combined_id===b.id)){
  expect(a.arabic_translations).toEqual(ledger.arabicCorrections[0].corrected)
  copy.arabic_translations=b.arabic_translations;copy.quiz=b.quiz
 }
 expect(copy).toEqual(b)
}
for(let i=0;i<before.vocabulary.sourceRows!.length;i++){
 const a=data.vocabulary.sourceRows![i],b=before.vocabulary.sourceRows![i],copy={...a,examples:b.examples}
 if(ledger.arabicCorrections.some((c:{rowId:string})=>c.rowId===b.id)){
  copy.arabic_translations=b.arabic_translations;copy.arabic_logical_lines=b.arabic_logical_lines;copy.review_fingerprint=b.review_fingerprint
 }
 expect(copy).toEqual(b)
}
})
it('fills exactly 44 prior gaps with accurate, separately checked provenance',()=>{
const ids=new Set(raw.contentEngineering.reviewSupplement.examples.map((e:{entryId:string})=>e.entryId))
const fresh=data.vocabulary.entries.filter(e=>ids.has(e.id)).flatMap(e=>e.examples)
expect(ids.size).toBe(44);expect(fresh).toHaveLength(44)
expect(fresh.filter(e=>e.source_type==='source_pdf')).toHaveLength(5)
expect(fresh.filter(e=>e.source_type==='generated')).toHaveLength(39)
for(const example of fresh){
 expect(example.arabic).toMatch(/\p{Script=Arabic}/u)
 expect(example.verification_status).toBe('language_checked')
 expect(example.verificationStatus).not.toMatch(/human|manually|^reviewed$/u)
 expect(example.example_review!.method).toContain('not_human')
}
expect(fresh.filter(e=>e.textbook_source?.section==='grammar_reference')).toHaveLength(1)
const appendix=fresh.find(e=>e.textbook_source?.section==='grammar_reference')!
expect(appendix.origin==='source_pdf'&&appendix.chapter).toBeNull()
const proofIndex=data.vocabulary.entries.findIndex(e=>e.examples.some(x=>x.textbook_source))
for(const mutation of ['hash','page','section']){
 const bad=structuredClone(data),ex=bad.vocabulary.entries[proofIndex].examples.find(e=>e.textbook_source)!
 if(mutation==='hash')ex.textbook_source!.sha256='0'.repeat(64)
 if(mutation==='page')ex.origin==='source_pdf'&&(ex.page=999)
 if(mutation==='section')Object.assign(ex.textbook_source!,{section:'unknown'})
 expect(()=>validateEducationPackage(bad)).toThrow()
}
})
it('accounts for all 371 candidates and never promotes the 1823 unresolved rows',()=>{
const report=JSON.parse(readFileSync(join(dirname(file!),'candidate-review-results.json'),'utf8'))
expect(report.inputCandidateRows).toBe(371)
expect((Object.values(report.totals) as number[]).reduce((a,b)=>a+b,0)).toBe(371)
expect(report.uniqueNewCanonical).toBe(31)
expect(report.originalUnresolvedRows).toBe(1823)
expect(report.unresolvedRowsAutomaticallyPromoted).toBe(0)
expect(report.originalReportUnmodified).toBe(true)
expect(report.originalUnresolvedSha256).toBe('0dd65c90807cc43e32ad97a36763b430adf44f8e64ee831e5f2c703e5476e71b')
})
it('renders approved examples only after correct or incorrect answers in both directions',async()=>{
const bank=await preparePersonalQuiz(data.vocabulary),pool=vocabularyCandidates(bank,'all',true)
for(const addition of raw.contentEngineering.reviewSupplement.examples){
 const entry=data.vocabulary.entries.find(e=>e.id===addition.entryId)
 const item=pool.find(c=>c.key==='word:'+germanKey(entry!.german)&&c.variant==='article')!.make()
 const markup=(results:('correct'|'incorrect')[]=[])=>renderToStaticMarkup(<StudyExercise items={[item]} close={()=>{}} position={{index:0,results,response:results.length?item.answers[0]:''}} />)
 expect(markup()).not.toContain('session-examples')
 for(const result of ['correct','incorrect'] as const){
  const html=markup([result]);expect(html).toContain('session-examples')
  expect(html).toContain('<p lang="de" dir="ltr">'+addition.german+'</p>')
  expect(html).toContain('<p lang="ar" dir="rtl">'+addition.arabic+'</p>')
 }
 const hidden={...item,examples:item.examples!.map(ex=>({...ex,verification_status:'needs_review' as const}))}
 expect(feedbackExamples(hidden.examples,'A1')).toEqual([])
 expect(renderToStaticMarkup(<StudyExercise items={[hidden]} close={()=>{}} position={{index:0,results:['correct'],response:''}} />)).not.toContain('session-examples')
}
})
it('keeps actual book references and respects excluded facts on flashcards',async()=>{
const bank=await preparePersonalQuiz(data.vocabulary)
const cards=vocabularyFlashcards(data.vocabulary,{level:'A1',chapters:[],type:'flashcard'},'de-ar',true)
for(const item of vocabularyCandidates(bank,'A1',true).filter(c=>c.origin==='vocabulary')){
 const q=item.make();const row=data.vocabulary.sourceRows!.find(r=>r.source_document&&germanKey(r.german??'')===item.key.slice(5))
 if(row)expect(q.source.document).toBe(row.source_document)
}
for(const row of data.vocabulary.sourceRows!.filter(r=>r.source_document)){
 expect(cards.find(c=>c.id==='card:de-ar:'+row.combined_id)?.source.document).toBe(row.source_document)
}
const plural=vocabularyFlashcards(data.vocabulary,{level:'A1',chapters:[],type:'flashcard'},'plural',true)
for(const exclusion of data.vocabulary.questionExclusions!.filter(e=>e.mode==='noun-plural')){
 const id=data.vocabulary.sourceRows!.find(r=>r.id===exclusion.sourceRowId)?.combined_id
 expect(plural.some(c=>c.id==='card:plural:'+id)).toBe(false)
}
})
it('runs 512 seeded final-bank rounds across both reliability modes, levels and counts',async()=>{
const bank=await preparePersonalQuiz(data.vocabulary)
for(let seed=0;seed<512;seed++){
 const level=seed%2?'A1':'A2',expanded=Math.floor(seed/2)%2===1
 const catalog=expanded?bank.getExpandedCatalog(level):bank.catalogs[level]
 let state=seed+1;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32}
 const count=[10,20,30,50][Math.floor(seed/4)%4] as 10|20|30|50
 const questions=makeQuiz(catalog,random,count)
 expect(questions).toHaveLength(Math.min(count,catalog.entryCount))
 expect(new Set(questions.map(q=>germanKey(q.entry.german))).size).toBe(questions.length)
 for(const q of questions){expect(q.choices.filter(c=>c.id===q.correctId)).toHaveLength(1);expect(new Set(q.choices.map(c=>c.text))).toHaveProperty('size',q.choices.length)}
}
})
})
