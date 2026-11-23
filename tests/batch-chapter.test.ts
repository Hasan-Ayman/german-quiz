import {readFileSync}from'node:fs'
import{join,dirname}from'node:path'
import{describe,it,expect}from'vitest'
import{validateEducationPackage}from'../src/education-package'
import{checkStudyAnswer}from'../src/study-engine'
import{preparePersonalQuiz}from'../src/personal-quiz'
import{availableStudyQuestions}from'../src/source-questions'
import{fromStudyQuestion,eligiblePractice,loadPracticePreferences,questionGroups}from'../src/practice'
import{adaptiveRound,buildEvidence}from'../src/learning-model'
import type{ChapterKey}from'../src/source-data'
const file=process.env.GERMAN_QUIZ_BATCH_FILE
describe.runIf(Boolean(file))('sequential chapter checkpoint',()=>{
const data=(file?validateEducationPackage(JSON.parse(readFileSync(file,'utf8'))):null)!
// Compare the browser importer representation on both sides. Legacy missing-
// example coverage flags are derived from source levels by that importer.
const old=(file?validateEducationPackage(JSON.parse(readFileSync(join(dirname(file),'baseline.backup.json'),'utf8'))):null)!
const stats=file&&JSON.parse(readFileSync(join(dirname(file),'statistics.json'),'utf8'))
it('preserves every previously accepted record and all other chapters',()=>{
expect(data.vocabulary.entries.slice(0,old.vocabulary.entries.length)).toEqual(old.vocabulary.entries)
expect(data.vocabulary.sourceRows?.slice(0,old.vocabulary.sourceRows!.length)).toEqual(old.vocabulary.sourceRows)
expect(data.study.chapters).toEqual(old.study.chapters)
expect(data.study.questions.slice(0,old.study.questions.length)).toEqual(old.study.questions)
expect(data.study.lessons.slice(0,old.study.lessons.length)).toEqual(old.study.lessons)
expect(data.study.questions.slice(old.study.questions.length).every((q:{chapter:string})=>q.chapter===stats.chapter)).toBe(true)
})
it('checks supported new answers, source evidence and guarded chapter exclusions',async()=>{
const fresh=data.study.questions.slice(old.study.questions.length)
expect(fresh).toHaveLength(stats.newQuestions)
for(const q of fresh){expect(checkStudyAnswer(q,q.answers[0])).toBe(true);expect(checkStudyAnswer(q,'WRONG 999')).toBe(false)
if(q.choices)expect(q.choices.filter((x:string)=>checkStudyAnswer(q,x))).toHaveLength(1)}
const bank=await preparePersonalQuiz(data.vocabulary)
expect([...bank.getExpandedCatalog('A2').facts.values()].some(f=>f.mode.endsWith('-synonym')&&f.chapters?.includes(stats.chapter))).toBe(false)
const active=availableStudyQuestions(data.study.questions,data.vocabulary.entries,true,data.vocabulary.questionExclusions)
const fieldModes={article:'article',plural:'noun-plural',preterite:'verb-preterite',perfect:'verb-perfect',comparative:'adjective-comparative',superlative:'adjective-superlative'}
for(const exclusion of data.vocabulary.questionExclusions??[]){
expect(active.some(q=>q.sourceEvidence?.rowId===exclusion.sourceRowId&&fieldModes[q.sourceEvidence.field]===exclusion.mode)).toBe(false)
}
const clone=structuredClone(data);clone.study.questions.at(-1)!.source.page=999
expect(()=>validateEducationPackage(clone)).toThrow()
})
it('retains every accepted chapter-one example and gates new contextual cards',()=>{
expect(data.vocabulary.entries.slice(0,old.vocabulary.entries.length).map((e:{examples:unknown})=>e.examples)).toEqual(old.vocabulary.entries.map((e:{examples:unknown})=>e.examples))
const reviewed=availableStudyQuestions(data.study.questions,data.vocabulary.entries,false)
expect(reviewed.some(q=>q.sourceVocabularyReview==='automatically_validated')).toBe(false)
for(const q of data.study.questions.slice(old.study.questions.length)){
expect(JSON.stringify(q)).not.toMatch(/\uFFFD|Ã¤|Ã¶|Ã¼|â€|Ø§/u)
expect(q.explanation).toMatch(/\p{Script=Arabic}/u)
if(q.passageRef)expect(data.study.readingPassages?.find(p=>p.id===q.passageRef)?.german).toContain(q.readingEvidence)
}
})
it('runs 504 scoped, unique mixed rounds on the cumulative real checkpoint',()=>{
const pool=availableStudyQuestions(data.study.questions,data.vocabulary.entries,true,data.vocabulary.questionExclusions).map(fromStudyQuestion)
const prefs=loadPracticePreferences(null,null)
for(let seed=0;seed<504;seed++){
const level=['A1','A2','all'][seed%3]
const chosen=data.study.chapters.filter(ch=>level==='all'||ch.id.startsWith(level+':')).map(ch=>ch.id as ChapterKey)
const eligible=eligiblePractice(pool,chosen,prefs,new Set(),new Map())
const count=[10,20,30,50][seed%4] as 10|20|30|50
const round=adaptiveRound(questionGroups(eligible),count,buildEvidence([]),1700000000000,seed)
expect(round).toHaveLength(count)
expect(new Set(round.map(q=>q.key)).size).toBe(count)
expect(round.every(q=>chosen.some(ch=>ch===q.chapter))).toBe(true)
expect(round.some(q=>q.activity==='writing')).toBe(false)
}
})
it('keeps book vocabulary provenance separate from glossary Arabic and human review',async()=>{
const rows=data.vocabulary.sourceRows?.filter(r=>r.source_document)??[]
if(stats.newCanonicalVocabulary)expect(rows.length).toBeGreaterThan(0)
const bank=await preparePersonalQuiz(data.vocabulary)
for(const row of rows){
expect(row.book_evidence?.humanVerified).toBe(false)
expect(row.book_evidence?.translation_origin).toBe('generated')
expect(row.verification_status).toBe('automated_pass')
expect(row.raw_arabic_glyph_lines).toEqual([])
expect([...bank.catalogs.A2.facts.values()].some(f=>f.entry.id===row.combined_id)).toBe(false)
const entry=data.vocabulary.entries.find(e=>e.id===row.combined_id)!
expect(entry.vocabularyStatus).toBe('automatically_validated')
expect(entry.sources.some(ref=>ref.document===row.source_document&&ref.sourcePdf===row.source_pdf)).toBe(true)
}
if(rows.length){
const invalid=structuredClone(data)
invalid.vocabulary.sourceRows!.find(r=>r.source_document)!.book_evidence!.sha256='0'.repeat(64)
expect(()=>validateEducationPackage(invalid)).toThrow()
const wrong=structuredClone(data)
wrong.vocabulary.sourceRows!.find(r=>r.source_document)!.source_page=1
expect(()=>validateEducationPackage(wrong)).toThrow()
}
})
})
