import type {StudyPack,TranscriptEvidence} from './study-content.ts'
import {normalizeStudyAnswer} from './study-content.ts'

// Optional provenance extension. Older four-source packages remain unchanged.
// A consistent proof is evidence of the recorded review, not human certification.
export function validateAnswerProvenance(study:StudyPack){
 const sources=study.answerSources??[]
 if(!Array.isArray(sources)||sources.length>1||sources.some(s=>!s||s.id!=='a2-solutions'||s.pages!==32||
   !/^[a-f0-9]{64}$/u.test(s.sha256)||typeof s.filename!=='string'||!s.filename.endsWith('.pdf')||s.editionIsbn!=='978-3-941323-31-5'))throw Error('Invalid answer booklet inventory')
 const source=sources[0]
 const bbox=(value:number[])=>Array.isArray(value)&&value.length===4&&value.every(Number.isFinite)&&value[0]<value[2]&&value[1]<value[3]
 const reference=(proof:TranscriptEvidence,chapter:string)=>{
  if(!proof||proof.sourceId!==source?.id||proof.sha256!==source.sha256||!Number.isInteger(proof.page)||proof.page<1||proof.page>source.pages||
   proof.humanVerified!==false||!proof.recordId.startsWith('a2-solutions:'+chapter.split(':')[1]+':')||!chapter.startsWith('A2:')||!bbox(proof.bbox)||!proof.rawTranscript?.trim())throw Error('Invalid transcript evidence')
 }
 for(const passage of study.readingPassages??[])if(passage.transcriptEvidence)reference(passage.transcriptEvidence,passage.chapter)
 for(const q of study.questions){
  if(q.transcriptEvidence){
   reference(q.transcriptEvidence,q.chapter)
   const passage=study.readingPassages?.find(p=>p.id===q.passageRef)
   if(q.type!=='reading'||q.contentBasis!=='transcript_based_reading'||JSON.stringify(passage?.transcriptEvidence)!==JSON.stringify(q.transcriptEvidence))throw Error('Transcript question differs from passage')
  }
  const proof=q.answerVerification
  if(!proof)continue
  const location=proof.questionLocation,ch=study.chapters.find(c=>c.id===q.chapter)
  if(proof.humanVerified!==false||!location||location.document!==q.source.document||location.page!==q.source.page||!bbox(location.bbox)||
   !['Hauptteil','Vertiefungsteil','Abschlusstest'].includes(location.section)||!location.exercise?.trim()||!location.item?.trim()||!location.rawQuestion?.trim()||!proof.rationale?.trim())throw Error('Missing original question evidence')
  if(proof.status==='official_answer'){
   const official=proof.official
   if(proof.method!=='ai_source_question_answer_match'||!official||!source||!q.chapter.startsWith('A2:')||official.sourceId!==source.id||official.sha256!==source.sha256||
    !Number.isInteger(official.page)||official.page<1||official.page>source.pages||official.recordId!==`a2-solutions:${ch?.number}:${location.section}:${location.exercise}`||
    !official.rawAnswer?.trim()||official.exampleAnswer!==false||JSON.stringify(official.acceptedAnswers)!==JSON.stringify(q.answers))throw Error('Invalid official answer match')
   let printed=official.rawAnswer
   if(official.wordJoins!==undefined){
    if(!Array.isArray(official.wordJoins)||official.wordJoins.length>30)throw Error('Invalid answer word joins')
    for(const join of official.wordJoins){
     if(join.method!=='ai_pdf_visual_word_join'||!/^\p{L}+-?\n\p{L}+$/u.test(join.original)||
       join.joined!==join.original.replace(/-?\n/u,'')||!printed.includes(join.original))throw Error('Unsupported answer text correction')
     printed=printed.replaceAll(join.original,join.joined)
    }
   }
   const raw=normalizeStudyAnswer(printed).replace(/\s+/gu,' ').toLowerCase()
   if(!q.answers.every(answer=>raw.includes(normalizeStudyAnswer(answer).toLowerCase())))throw Error('Official answer missing accepted alternative')
  }else if(proof.status!=='ai_derived_verified'||proof.method!=='ai_grammar_context_review'||proof.official)throw Error('AI solution mislabeled official')
 }
}
