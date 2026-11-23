// Conservative, source-context classification. No classifier result activates content.
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,join,relative,isAbsolute} from 'node:path'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'

const clean=s=>s.normalize('NFC').replace(/^[^\p{L}]+|[^\p{L}]+$/gu,'')
export function classifyOccurrence({surface,context,top,pageHeight,document},index,policy={}) {
 const s=clean(surface),lower=s.toLocaleLowerCase('de'),line=context.trim()
 const result=(category,reason,refs=[])=>({category,reason,refs,verification:'automated_context_classification',humanVerified:false,active:false})
 if(top<48||top>pageHeight-43)return result('exercise_instructions','Header/footer or source credit; coordinates retained, not a lexical rejection')
 if(/^(?:Hören|Lesen|Schreiben|Ergänzen|Ordnen|Kreuzen|Markieren|Bilden|Formulieren|Sprechen|Fragen|Antworten|Vergleichen|Arbeiten|Wählen|Notieren|Unterstreichen|Spielen|Tauschen|Achten|Berichten|Nennen|Suchen|Verbinden|Wiederholen)\s/iu.test(line)||/^(?:SINGULAR|PLURAL|PRÄTERITUM|PERFEKT|SYNONYM|ADJEKTIV|ADVERB|VERBEN|NOMEN|BEDEUTUNG|STEIGERUNG|GEGENTEIL)(?:\s|$)/u.test(line))return result('exercise_instructions','Instruction/table-heading context; not automatically a study lemma')
 if((policy.names??[]).includes(s))return result('proper_names','Explicit source-name review list; homographs require a separate ambiguity rule')
 if((policy.ambiguous??[]).includes(s))return result('unresolved','Homograph or multiple contextual roles; no case-folded automatic sense assignment')
 const linked=index.lemmas.get(s)??(/^[a-zäöüß]/u.test(s)?index.folded.get(lower):undefined)
 if(linked)return result('existing_vocabulary_occurrences','Exact lemma/explicit alternate (not substring or stemming); semantic approval unchanged',linked)
 const forms=index.forms.get(s)??index.forms.get(lower)
 if(forms)return result('inflected_forms','Exact printed grammatical form or documented table cell, not suffix inference',forms)
 if(/^[A-Za-z]$/u.test(s))return result('exercise_instructions','Isolated exercise letter/speaker label; not expanded into a word')
 if((policy.artifacts??[]).includes(s))return result('extraction_artifacts','Explicitly reviewed broken text-layer token; original preserved, no automatic correction')
 if((policy.candidates??[]).includes(s))return result('valid_new_lexical_candidates','Whole contextual word on review list; candidate only, no grammar/translation/eligibility approval')
 if(/^[A-ZÄÖÜ][a-zäöüß]{3,}(?:-[A-ZÄÖÜa-zäöüß]+)?$/u.test(s)&&new RegExp('(?:der|die|das|ein|eine|einen|einem|einer)\\s+'+s+'(?:[\\s.,;:!?]|$)','u').test(line))return result('valid_new_lexical_candidates','Noun candidate preceded by a printed article in the same isolated line; unapproved')
 return result('unresolved','Insufficient evidence for safe lexical/category association; original context retained')
}

export async function classifyArchives(oldFolder,datasetFile,output,policyFile){
 const repo=fileURLToPath(new URL('../',import.meta.url)),rel=relative(repo,resolve(output));assert(rel&&(rel.startsWith('..')||isAbsolute(rel)))
 const read=async p=>JSON.parse(await readFile(p,'utf8'))
 const data=await read(datasetFile),policy=policyFile?await read(policyFile):{},index={lemmas:new Map(),folded:new Map(),forms:new Map()}
 const put=(map,k,ref)=>{const refs=map.get(k)??[];refs.push(ref);map.set(k,refs)}
 for(const e of data.vocabulary.entries)for(const alias of e.german.split('/')){
  const s=alias.trim().replace(/^(der|die|das)\s+/u,'');put(index.lemmas,s,{id:e.id,part:e.part_of_speech})
  if(e.part_of_speech!=='noun')put(index.folded,s.toLocaleLowerCase('de'),{id:e.id,part:e.part_of_speech})
 }
 for(const r of data.vocabulary.sourceRows)for(const field of ['plural','preterite','perfect','comparative','superlative']){
  const v=r[field];if(!v)continue
  for(const token of v.replace(/^(?:der|die|das|am|hat|ist)\s+/u,'').split(/[\s/]+/u))if(/^[\p{L}]{3,}$/u.test(token))put(index.forms,token,{rowId:r.id,field,printed:v,headOnly:v.includes(' ')})
 }
 for(const [chapter,curation]of Object.entries(data.contentEngineering?.chapterBatch??{}))for(const table of curation.tables??[])if(table.id==='conjugation')for(const row of table.rows)for(const v of row.slice(1)){
  const token=v.split(' ')[0];put(index.forms,token,{chapter,page:table.page,field:'printed_conjugation',printed:v,headOnly:v.includes(' ')})
 }
 const rows=[],totals={},occurrenceTotals={}
 for(const n of [2,3,4]){
  const archive=await read(join(oldFolder,'A1-'+n,'contextual-vocabulary-archive.json')),pages=new Map()
  for(const row of archive.rows.filter(r=>!r.exactSourceLinks.length)){
   const occurrences=[]
   for(const occurrence of row.occurrences){
    const key=occurrence.document+':'+occurrence.page
    if(!pages.has(key))pages.set(key,await read(join(oldFolder,'A1-'+n,'layout',occurrence.document+'-'+String(occurrence.page).padStart(3,'0')+'.json')))
    const page=pages.get(key),line=page.lines.find(l=>l.wordIds.includes(occurrence.wordId)),word=page.words.find(w=>w.id===occurrence.wordId)
    assert(word&&line,'Missing original coordinate/line reference')
    const classified=classifyOccurrence({surface:row.surface,context:line.text,top:occurrence.bbox[1],pageHeight:page.height,document:occurrence.document},index,policy)
    occurrences.push({...occurrence,context:line.text,...classified});occurrenceTotals[classified.category]=(occurrenceTotals[classified.category]??0)+1
   }
   const categories=[...new Set(occurrences.map(o=>o.category))],category=categories.length===1?categories[0]:'unresolved'
   totals[category]=(totals[category]??0)+1
   rows.push({chapter:'A1:'+n,surface:row.surface,category,occurrenceCategories:categories,mixedContext:categories.length>1,status:'classification_only_not_approval',active:false,occurrences})
  }
 }
 assert.equal(rows.length,2902,'Baseline unlinked count changed; investigate rather than silently replacing it')
 const report={version:1,baselineSurfaceRows:2902,uniqueSurfaceStrings:new Set(rows.map(r=>r.surface)).size,totalOccurrences:rows.reduce((n,r)=>n+r.occurrences.length,0),surfaceTotals:totals,occurrenceTotals,automaticPromotions:0,newCanonicalFromClassification:0,notes:['Per-chapter surface rows are not 2902 new lemmas. Mixed roles remain unresolved at surface level.','Case folding never links capitalized noun homographs to lower-case verbs. Printed form linkage is morphological evidence, not approval of a contextual meaning.','Unresolved items stay in private review queue; no spelling repair, suffix guessing or hidden activation.'],rows}
 await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,rows:undefined}))
 return report
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await classifyArchives(...process.argv.slice(2))
