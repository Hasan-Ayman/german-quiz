import {readFileSync} from 'node:fs'
import {isDeepStrictEqual} from 'node:util'
import {describe,it,expect} from 'vitest'
import {compareTeacherVocabulary,normalizeTeacherValue} from '../scripts/teacher_vocabulary.mjs'
import {validateEducationPackage} from '../src/education-package.ts'
import {preparePersonalQuiz} from '../src/personal-quiz.ts'
import {makeQuiz,isCorrect,germanKey,modes} from '../src/quiz.ts'

// Synthetic comparator fixtures; no educational source content is bundled.
const row={id:'test-row',level:'A1',chapter_number:1,source_page:3,source_row:1,source_bbox:[1,2,3,4],german:'Alpha',part_of_speech:'noun',article:'der',plural:null,arabic_translations:['معنى أول'],combined_id:'test-entry',verification_status:'automated_pass'}
const compare=(fresh,old=row,issues=[],entries=[{id:'test-entry'}])=>compareTeacherVocabulary({vocabulary:{sourceRows:[old],entries}},{sources:[{id:'test-vocab',level:'A1',filename:'synthetic.pdf',sha256:'0'.repeat(64),pages:4,rows:1}],rows:[fresh],structuralChecks:[{id:fresh.id,issues}]})
it('normalizes Unicode and whitespace without rewriting Arabic or folding ß into ss',()=>{
 expect(normalizeTeacherValue('  A\u0308\tß  ')).toBe('Ä ß')
 expect(normalizeTeacherValue('مَعْنًى')).toBe('مَعْنًى')
 expect(normalizeTeacherValue([])).toBe(null)
})
it('recognizes normalized duplicates without mutating either record',()=>{
 const fresh={...row,german:' Alpha  '},saved=structuredClone(fresh)
 const result=compare(fresh)
 expect(result.counts.categories.A).toBe(1)
 expect(result.counts.normalizedDuplicatesOfExisting).toBe(1)
 expect(fresh).toEqual(saved)
})
it('keeps homographs with different articles, senses, POS or case out of automatic merging',()=>{
 for(const patch of [{article:'das'},{part_of_speech:'verb',article:null},{arabic_translations:['معنى آخر']},{german:'alpha'}]){
  const result=compare({...row,...patch})
  expect(result.counts.categories.D).toBe(1)
  expect(result.automaticPromotions).toBe(0)
 }
})
it('identifies a genuinely missing field as a review candidate rather than inventing a value',()=>{
 const result=compare({...row,plural:'printed plural'})
 expect(result.counts.categories.B).toBe(1)
 expect(result.records[0].missingFields).toEqual(['plural'])
 expect(row.plural).toBe(null)
})
it('defers flags, source mismatches and inactive rows without changing existing approvals',()=>{
 for(const result of [compare(row,row,['uncertain_cell']),compare({...row,source_page:4}),compare(row,row,[],[])]){
  expect(result.counts.categories.D).toBe(1)
  expect(result.existingEligibilityChanged).toBe(false)
  expect(result.records[0].existingApprovalChanged).toBe(false)
 }
})
it('never approves a new lexical candidate solely from a clean extraction',()=>{
 const result=compare({...row,id:'unlinked'})
 expect(result.counts.categories.C).toBe(0)
 expect(result.counts.categories.D).toBe(1)
})

const file=process.env.GERMAN_QUIZ_TEACHER_FILE,base=process.env.GERMAN_QUIZ_TEACHER_BASELINE,reportFile=process.env.GERMAN_QUIZ_TEACHER_REPORT
describe.runIf(Boolean(file&&base&&reportFile))('complete private teacher integration',()=>{
 it('imports the complete file and preserves every educational payload and previous audit',()=>{
  const before=validateEducationPackage(JSON.parse(readFileSync(base,'utf8'))),after=validateEducationPackage(JSON.parse(readFileSync(file,'utf8')))
  expect(isDeepStrictEqual(after.vocabulary,before.vocabulary)).toBe(true)
  expect(isDeepStrictEqual(after.study,before.study)).toBe(true)
  for(const[k,v]of Object.entries(before.contentEngineering))expect(isDeepStrictEqual(after.contentEngineering[k],v)).toBe(true)
  expect(after.vocabulary.entries).toHaveLength(1635)
  expect(after.study.chapters).toHaveLength(24)
  expect(after.study.lessons).toHaveLength(236)
  expect(after.study.questions).toHaveLength(4217)
  expect(after.study.readingPassages).toHaveLength(184)
  expect(after.vocabulary.entries.flatMap(e=>e.examples)).toHaveLength(1842)
  expect(JSON.parse(JSON.stringify(after))).toEqual(after)
 })
 it('accounts for both complete sources and all deferred comparisons without promotions',()=>{
  const report=JSON.parse(readFileSync(reportFile,'utf8'))
  expect(report.sources.map(s=>s.rows)).toEqual([721,854])
  expect(report.sources.map(s=>s.pages)).toEqual([62,50])
  expect(report.counts.sourceRows).toBe(1575)
  expect(report.counts.categories).toEqual({A:1518,B:0,C:0,D:57})
  expect(report.counts.existingRowsWithDifferentEducationalValues).toBe(9)
  expect(report.counts.structurallyFlaggedSourceRows).toBe(52)
  expect(report.counts.existingRowsWithoutActiveCanonicalRecord).toBe(2)
  expect(report.automaticPromotions).toBe(0)
  expect(new Set(report.records.map(r=>r.rowId)).size).toBe(1575)
 })
 it('keeps the quiz fingerprint and grading identical and runs 64 seeded rounds',async()=>{
  const before=validateEducationPackage(JSON.parse(readFileSync(base,'utf8'))),after=validateEducationPackage(JSON.parse(readFileSync(file,'utf8')))
  const [old,bank]=await Promise.all([preparePersonalQuiz(before.vocabulary),preparePersonalQuiz(after.vocabulary)])
  expect(bank.revision).toBe(old.revision)
  const catalogs=[bank.catalogs.A1,bank.catalogs.A2,bank.getExpandedCatalog('A1'),bank.getExpandedCatalog('A2')],seen=new Set()
  for(let seed=0;seed<64;seed++){
   let state=seed+1;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32}
   const catalog=catalogs[seed%4],count=[10,20,30,50][Math.floor(seed/4)%4],round=makeQuiz(catalog,random,count)
   expect(round).toHaveLength(Math.min(count,catalog.entryCount))
   expect(new Set(round.map(q=>germanKey(q.entry.german))).size).toBe(round.length)
   for(const q of round){seen.add(q.mode);expect(q.choices.filter(c=>isCorrect(q,c.id))).toHaveLength(1)
    if(q.mode==='article')expect(q.choices).toHaveLength(3)
    else if(!catalog.facts.get(q.id).optionCount)for(const[i,c]of q.choices.entries())for(const other of q.choices.slice(i+1))expect(catalog.compatible(c.id,other.id)).toBe(true)
   }
  }
  expect(modes.every(m=>seen.has(m))).toBe(true)
 },20000)
})
