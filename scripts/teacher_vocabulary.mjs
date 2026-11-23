// Conservative comparison. Normalization is for matching, never source rewriting.
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,relative,isAbsolute} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {validateEducationPackage} from '../src/education-package.ts'

export const teacherFields=['german','part_of_speech','article','article_note','plural','preterite','perfect','comparative','superlative','adverb_type','arabic_translations','synonyms','antonyms','example_sentence']
const missing=v=>v==null||v===''||Array.isArray(v)&&v.length===0
export const normalizeTeacherValue=v=>missing(v)?null:typeof v==='string'?v.normalize('NFC').replace(/\s+/gu,' ').trim():Array.isArray(v)?v.map(normalizeTeacherValue):v
const equal=(a,b)=>JSON.stringify(normalizeTeacherValue(a))===JSON.stringify(normalizeTeacherValue(b))
const projection=row=>Object.fromEntries(teacherFields.map(f=>[f,row[f]??null]))
const normalizedProjection=row=>Object.fromEntries(teacherFields.map(f=>[f,normalizeTeacherValue(row[f])]))
const lemmaKey=row=>[normalizeTeacherValue(row.german)?.toLocaleLowerCase('de-DE'),row.part_of_speech,row.article??null].join('|')

export function compareTeacherVocabulary(dataset,extracted){
 const byId=new Map(dataset.vocabulary.sourceRows.map(r=>[r.id,r]))
 const entryIds=new Set(dataset.vocabulary.entries.map(e=>e.id))
 const sourceByLevel=new Map(extracted.sources.map(s=>[s.level,s]))
 const checks=new Map(extracted.structuralChecks.map(c=>[c.id,c.issues]))
 const records=extracted.rows.map(row=>{
  const old=byId.get(row.id),source=sourceByLevel.get(row.level)
  assert(source&&row.source_page>=1&&row.source_page<=source.pages)
  const issues=checks.get(row.id)??['structural_checks_unavailable']
  if(!old)return{rowId:row.id,category:'D',reason:'Unlinked source row; clean extraction alone cannot approve a new lexical sense.',source:{document:source.id,page:row.source_page},issues,caseFoldedCandidateKey:lemmaKey(row),activated:false}
  const differences=teacherFields.filter(f=>!equal(row[f],old[f]))
  const missingFields=differences.filter(f=>missing(old[f])&&!missing(row[f]))
  const conflictFields=differences.filter(f=>!missing(old[f]))
  const identityMismatch=old.level!==row.level||old.chapter_number!==row.chapter_number||old.source_page!==row.source_page||old.source_row!==row.source_row||!equal(old.source_bbox,row.source_bbox)||old.source_document
  const pending=old.verification_status==='needs_manual_review'||!entryIds.has(old.combined_id)
  const category=identityMismatch||issues.length||pending||conflictFields.length?'D':missingFields.length?'B':'A'
  const exact=JSON.stringify(projection(row))===JSON.stringify(projection(old))
  return{rowId:row.id,entryId:old.combined_id,level:row.level,chapter:row.chapter_number,part:row.part_of_speech,
   source:{document:source.id,filename:source.filename,sha256:source.sha256,page:row.source_page,bbox:row.source_bbox},
   category,duplicateKind:!differences.length?(exact?'exact':'normalized'):null,
   reason:category==='A'?'Existing source row and educational fields already retained; no second canonical entry created.':
    category==='B'?'Missing fields are candidates for explicit source review; not approved merely by extraction.':
    'Extraction flags, prior pending state, source mismatch or differing values retained for comparison; existing corrections and eligibility unchanged.',
   issues,differences:differences.map(field=>({field,extracted:row[field]??null,existing:old[field]??null})),missingFields,conflictFields,
   identityMismatch:Boolean(identityMismatch),existingVerification:old.verification_status,existingCanonicalRecord:entryIds.has(old.combined_id),
   existingApprovalChanged:false,activated:false}
 })
 const count=category=>records.filter(r=>r.category===category).length
 const signatures=new Map()
 for(const row of extracted.rows){const key=JSON.stringify(normalizedProjection(row));const group=signatures.get(key)??[];group.push(row.id);signatures.set(key,group)}
 const duplicateGroups=[...signatures.values()].filter(g=>g.length>1)
 const canonical=new Set(extracted.rows.map(r=>byId.get(r.id)?.combined_id).filter(Boolean))
 return{version:1,scope:'Both teacher vocabulary PDFs in one coordinated batch',sources:extracted.sources,
  counts:{sourceRows:extracted.rows.length,categories:{A:count('A'),B:count('B'),C:0,D:count('D')},
   exactDuplicatesOfExisting:records.filter(r=>r.category==='A'&&r.duplicateKind==='exact').length,
   normalizedDuplicatesOfExisting:records.filter(r=>r.category==='A'&&r.duplicateKind==='normalized').length,
   existingRowsWithDifferentEducationalValues:records.filter(r=>r.differences?.length).length,
   structurallyFlaggedSourceRows:extracted.structuralChecks.filter(c=>c.issues.length).length,
   existingEntriesEnriched:0,newEntriesAccepted:0,newExamples:0,
   linkedCanonicalIdsIncludingInactive:canonical.size,linkedExistingCanonicalEntries:[...canonical].filter(id=>entryIds.has(id)).length,
   existingRowsWithoutActiveCanonicalRecord:records.filter(r=>r.existingCanonicalRecord===false).length,
   duplicateSourceGroups:duplicateGroups.length,repeatedSourceRows:duplicateGroups.reduce((n,g)=>n+g.length-1,0)},
  records,duplicateGroups,normalization:'NFC and whitespace; null/empty optional fields compare as unavailable. Case-folded keys are candidates only; POS, article, grammatical facts and sense conflicts prevent merging.',
  humanVerified:false,automaticPromotions:0,existingEligibilityChanged:false,
  note:'D is a comparison queue, not a new rejection or downgrade. Prior review states, corrections, source flags and accepted content stay unchanged.'}
}

async function main(){
 const [input,extractionFile,folderArg]=process.argv.slice(2),folder=resolve(folderArg)
 const rel=relative(fileURLToPath(new URL('../',import.meta.url)),folder)
 assert(rel&&(rel.startsWith('..')||isAbsolute(rel)),'Private output must remain outside Git')
 const bytes=await readFile(input),hash=b=>createHash('sha256').update(b).digest('hex')
 const old=validateEducationPackage(JSON.parse(bytes)),extracted=JSON.parse(await readFile(extractionFile,'utf8'))
 const report=compareTeacherVocabulary(old,extracted)
 // This actual pair of sources is already present. Never manufacture additions.
 assert.equal(report.counts.categories.B,0,'Source-reviewed enrichment plan required for genuinely missing fields')
 assert.equal(report.counts.newEntriesAccepted,0)
 const data=structuredClone(old)
 data.contentEngineering={...data.contentEngineering,teacherVocabularyIntegration:{version:1,baselineSha256:hash(bytes),
  status:'already_integrated_no_educational_changes',sources:extracted.sources.map(s=>({id:s.id,filename:s.filename,sha256:s.sha256,pages:s.pages,rows:s.rows,legacyAlias:s.level+'.pdf',cacheSha256:s.cacheSha256})),
  counts:report.counts,allOriginalEducationalContentPreserved:true,humanVerified:false,automaticPromotions:0,
  reviewPolicy:'Conservative structural/normalization comparison; unresolved extraction candidates do not overwrite previously accepted data.'}}
 const checked=validateEducationPackage(data)
 assert.deepEqual(checked.vocabulary,old.vocabulary);assert.deepEqual(checked.study,old.study)
 for(const[k,v]of Object.entries(old.contentEngineering))assert.deepEqual(checked.contentEngineering[k],v)
 const text=JSON.stringify(checked,null,2)+'\n';assert(Buffer.byteLength(text)<20*1024*1024)
 const output=resolve(folder,'german-quiz-complete-teacher-integrated-private.json')
 await writeFile(output,text,{flag:'wx'})
 await writeFile(resolve(folder,'comparison-report.private.json'),JSON.stringify(report,null,2)+'\n')
 await writeFile(resolve(folder,'deferred-comparisons.private.json'),JSON.stringify({version:1,records:report.records.filter(r=>r.category!=='A'),existingStatusesAndEligibilityUnchanged:true,humanVerified:false},null,2)+'\n')
 await writeFile(resolve(folder,'integration-summary.json'),JSON.stringify({version:1,file:output,sha256:hash(text),bytes:Buffer.byteLength(text),baselineSha256:hash(bytes),counts:report.counts,
  before:{vocabulary:old.vocabulary.entries.length,chapters:old.study.chapters.length,lessons:old.study.lessons.length,activities:old.study.questions.length,readings:old.study.readingPassages.length,examples:old.vocabulary.entries.flatMap(e=>e.examples).length},
  educationalPayloadUnchanged:true,metadataOnlyIntegrationAudit:true,private:true,committed:false,pushed:false,deployed:false},null,2)+'\n')
 console.log(JSON.stringify({file:output,sha256:hash(text),bytes:Buffer.byteLength(text),...report.counts}))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main()
