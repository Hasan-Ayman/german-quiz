import { validateSourceQuestions } from './source-questions.ts'
import {validateAnswerProvenance} from './official-answers.ts'
import { ImportProblem, importMessage } from './import-problem.ts'
import { maximumDatasetBytes, readPrivateJson, validatePersonalDataset, type PersonalDataset } from './personal-data.ts'
import { validateStudyPack, type StudyPack } from './study-content.ts'
import type {ExplanationSupplement,QuestionFeedback} from './learning-library.ts'

export const educationFormat = 'german-quiz-education'
export const educationVersion = 1
export const educationFilename = 'german-quiz-final-complete.json'
export const maximumEducationBytes = maximumDatasetBytes + 8 * 1024 * 1024

export type EducationPackage = {
  format: typeof educationFormat
  version: typeof educationVersion
  vocabulary: PersonalDataset
  study: StudyPack
  explanations?: ExplanationSupplement
  feedback?: QuestionFeedback[]
}

export function validateEducationPackage(input: unknown): EducationPackage {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ImportProblem('schema', 'Expected an education package')
  const value = input as Record<string, unknown>
  if (value.format !== educationFormat || value.version !== educationVersion) {
    throw new ImportProblem('schema', 'Unsupported unified education package')
  }
  if (!Object.hasOwn(value, 'vocabulary') || !Object.hasOwn(value, 'study')) {
    throw new ImportProblem('missing', 'Both parts of the unified package are required')
  }
  const vocabulary = validatePersonalDataset(value.vocabulary)
  if(value.feedback!==undefined) {
    const records=value.feedback as QuestionFeedback[]
    const validText=(input:unknown, limit=12000):input is string =>
      typeof input==='string' && input.trim().length>0 && input.length<=limit && !/[\uFFFD\u0000]/u.test(input)
    if(!Array.isArray(records)||records.length>40000||records.some(r=>!r||r.method!=='bound_fact_rules_v1'||
       ![r.questionId,r.prompt,r.answer,r.text].every(t=>validText(t))||!/\p{Script=Arabic}/u.test(r.text)||
       (r.options!==undefined&&(!r.options||typeof r.options!=='object'||Array.isArray(r.options)||
          Object.entries(r.options).some(([answer,note])=>!validText(answer,2000)||answer===r.answer||!validText(note,2000)||!/\p{Script=Arabic}/u.test(note))||
          Object.keys(r.options).length>8)))||
       new Set(records.map(r=>JSON.stringify([r.questionId,r.prompt,r.answer]))).size!==records.length)
      throw new ImportProblem('schema','Invalid question feedback')
  }
  if(value.explanations!==undefined){
    const supplement=value.explanations as ExplanationSupplement
    if(supplement?.version!==1||!Array.isArray(supplement.records)||supplement.records.length>40000||
      new Set(supplement.records.map(r=>JSON.stringify([r?.questionId,r?.prompt,r?.answer]))).size!==supplement.records.length||supplement.records.some(r=>
        !r||r.origin!=='generated'||r.verification!=='automated_checked'||r.method!=='approved_fact_template_v1'||
        [r.questionId,r.prompt,r.answer,r.text].some(s=>typeof s!=='string'||!s.trim()||s.length>12000||/[\uFFFD\u0000]/u.test(s))||!/\p{Script=Arabic}/u.test(r.text)))throw new ImportProblem('schema','Invalid explanation supplement')
  }
  try {
    const study = validateStudyPack(value.study, true)
    for (const row of vocabulary.sourceRows ?? []) {
      if (!row.source_document) continue
      const chapter=study.chapters.find(ch=>ch.id===row.level+':'+row.chapter_number)
      const source=study.sources.find(s=>s.id===row.source_document)
      if (!chapter || chapter.source!==row.source_document || row.source_page<chapter.startPage || row.source_page>chapter.endPage ||
          row.book_evidence?.sha256!==source?.sha256) throw new Error('Book vocabulary reference differs from source inventory')
    }
    for(const entry of vocabulary.entries)for(const example of entry.examples){
      const proof=example.textbook_source
      if(!proof)continue
      const source=study.sources.find(s=>s.id===proof.document)
      const chapters=study.chapters.filter(ch=>ch.source===proof.document)
      const chapter=chapters.find(ch=>ch.number===proof.chapter)
      if(example.origin!=='source_pdf'||proof.sha256!==source?.sha256||example.page>source.pages||
        (proof.section==='chapter' ? !chapter||example.page<chapter.startPage||example.page>chapter.endPage :
          example.page<=Math.max(...chapters.map(ch=>ch.endPage))))throw new Error('Textbook example source differs from inventory')
    }
    validateSourceQuestions(study.questions, vocabulary, study.readingPassages, study.sourceActivities)
    validateAnswerProvenance(study)
    return { ...value, format: educationFormat, version: educationVersion, vocabulary, study }
  } catch (error) {
    throw new ImportProblem('study', 'Invalid study content', undefined, undefined, { cause: error })
  }
}

export function createEducationPackage(vocabulary: PersonalDataset, study: StudyPack): EducationPackage {
  return { format: educationFormat, version: educationVersion, vocabulary, study }
}

export const readEducationFile = (file: Parameters<typeof readPrivateJson>[0]) => readPrivateJson(file, maximumEducationBytes)
export const serializeEducationPackage = (content: EducationPackage) => JSON.stringify(content) + '\n'

export function educationImportMessage(error: unknown) {
  if (!(error instanceof ImportProblem)) return 'حدث خطأ أثناء تجهيز المحتوى. أعد فتح التطبيق وحاول مجددًا.'
  switch (error.code) {
    case 'empty': return 'الملف فارغ. اختر ملف المحتوى التعليمي الكامل.'
    case 'size': return 'ملف المحتوى أكبر من الحجم المدعوم (٢٠ ميبيبايت). اختر النسخة الأصلية.'
    case 'schema': return 'تنسيق ملف المحتوى أو إصداره غير مدعوم. اختر ملف المحتوى التعليمي الموحّد.'
    case 'missing': return 'ملف المحتوى ناقص. اختر النسخة الكاملة التي تتضمن المفردات ومحتوى الدراسة.'
    default: return importMessage(error)
  }
}
