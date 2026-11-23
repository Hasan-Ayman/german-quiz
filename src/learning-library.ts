import {grammarTypes,isGrammarMode} from './question-types.ts'
import {availableStudyQuestions} from './source-questions.ts'
import {practiceChapters,fromStudyQuestion,questionGroups,type Candidate} from './practice.ts'
import {vocabularyCandidates} from './practice-vocabulary.ts'
import {questionChoices,germanKey} from './quiz.ts'
import {checkStudyAnswer} from './study-engine.ts'
import {normalizeStudyAnswer,type StudyQuestion,type StudyPack} from './study-content.ts'
import type {PersonalQuiz} from './personal-quiz.ts'
import {adaptiveRound,type Evidence} from './learning-model.ts'

export type ExplanationRecord={questionId:string;prompt:string;answer:string;text:string;origin:'generated';verification:'automated_checked';method:'approved_fact_template_v1'}
export type ExplanationSupplement={version:1;records:ExplanationRecord[]}
export type QuestionFeedback = {
 questionId: string
 prompt: string
 answer: string
 text: string
 options?: Record<string, string>
 method: 'bound_fact_rules_v1'
}
export type LearningItem=Omit<Candidate,'make'>&{view:StudyQuestion;multipleChoice:boolean;make:(random?:()=>number)=>StudyQuestion}
export type LearningLibrary=ReturnType<typeof buildLearningLibrary>
const binding=(id:string,prompt:string,answer:string)=>JSON.stringify([id,prompt,answer])

export function validateQuestionFeedback(
 records:readonly QuestionFeedback[], bank:PersonalQuiz, pack:StudyPack,
) {
 const bindings=new Map<string,Set<string>>()
 const active=availableStudyQuestions(pack.questions,bank.dataset.entries,true,bank.dataset.questionExclusions)
 for(const q of active)bindings.set(binding(q.id,q.prompt,q.answers[0]),new Set(q.choices?.filter(c=>!checkStudyAnswer(q,c))))
 for(const f of bank.getExpandedCatalog('A2').facts.values()){
  const options=f.mode==='article'?['der','die','das'].filter(v=>v!==f.correct.text):f.distractors.map(d=>d.text)
  bindings.set(binding(f.id,f.prompt.text,f.correct.text),new Set(options))
 }
 for(const record of records){
  const options=bindings.get(binding(record.questionId,record.prompt,record.answer))
  if(!options||Object.keys(record.options??{}).some(option=>!options.has(option)))
   throw new Error('Feedback does not match an eligible question and wrong option')
 }
}
export const cleanChoices=(q:StudyQuestion)=>Boolean(q.choices&&q.choices.length>=2&&q.choices.length<=8&&
 !['writing','matching','flashcard','order'].includes(q.type)&&q.errorIndex===undefined&&
 new Set(q.choices.map(c=>normalizeStudyAnswer(c,q.answerLanguage??(q.type==='reading'?'ar':'de')))).size===q.choices.length&&
 q.choices.filter(c=>checkStudyAnswer(q,c)).length===1)

export function buildLearningLibrary(bank:PersonalQuiz|null,pack:StudyPack|null,expanded:boolean,supplement?:ExplanationSupplement,feedback?:readonly QuestionFeedback[]){
 const explanations=new Map(supplement?.records.map(r=>[binding(r.questionId,r.prompt,r.answer),r])??[])
 const feedbackIndex=new Map(feedback?.map(r=>[binding(r.questionId,r.prompt,r.answer),r])??[])
 const attach=(q:StudyQuestion,factId=q.id)=>{
  const improved=feedbackIndex.get(binding(factId,q.prompt,q.answers[0]))
  if(improved)return {...q,explanation:improved.text,...(improved.options ? {optionFeedback:improved.options} : {})}
  const proof=explanations.get(binding(factId,q.prompt,q.answers[0]))
  return !q.explanation&&proof?.prompt===q.prompt&&proof.answer===q.answers[0]?{...q,explanation:proof.text}:q
 }
 const entries=new Map(bank?.dataset.entries.map(e=>[e.id,e]))
 const words=new Map(bank?.dataset.entries.map(e=>[e.id,e.german]))
 const items:LearningItem[]=availableStudyQuestions(pack?.questions??[],bank?.dataset.entries??[],expanded,bank?.dataset.questionExclusions).map(q=>{
  const view=attach(q),base=fromStudyQuestion(view)
  // The same tested fact can be stored as both a verb and a cloze activity.
  // Keep all source records, but ask that exact prompt/answer only once per test.
  base.key=JSON.stringify([normalizeStudyAnswer(q.prompt,q.promptLanguage??'de'),
   q.answers.map(a=>normalizeStudyAnswer(a,q.answerLanguage??(q.type==='reading'?'ar':'de'))).sort(),
   q.hint?.text??'',q.type==='reading'?q.instruction:''])
  if(q.sourceEvidence&&words.has(q.sourceEvidence.entryId))base.key='word:'+germanKey(words.get(q.sourceEvidence.entryId)!)
  return{...base,view,multipleChoice:cleanChoices(view),make:()=>view}
 })
 if(bank){
  const catalog=expanded?bank.getExpandedCatalog('A2'):bank.catalogs.A2
  for(const c of vocabularyCandidates(bank,'all',expanded)){
   const factId=c.id.slice('study:'.length,-c.chapter.length-1),fact=catalog.facts.get(factId)
   if(!fact)continue
   const reference=entries.get(fact.entry.id)?.sources.find(r=>`${r.level}:${r.chapter}`===c.chapter&&(!fact.sourcePages?.[c.chapter as `A1:${number}`|`A2:${number}`]||r.page===fact.sourcePages[c.chapter as `A1:${number}`|`A2:${number}`]))
   if(!reference)continue
   // Static previews do not sample or allocate distractors for thousands of cards.
   const view=attach({id:c.id,chapter:c.chapter,topic:'',type:c.activity==='verb'?'verb':'vocabulary',activity:c.activity,
    origin:'vocabulary',skill:fact.mode==='verb'?'verb-meaning':fact.mode,verification:fact.entry&&'vocabularyStatus'in fact.entry&&fact.entry.vocabularyStatus==='reviewed'?'reviewed':'automated_checked',
    source:{document:reference.document??(reference.level==='A1'?'a1-vocab':'a2-vocab'),page:reference.page},
    prompt:fact.prompt.text,promptLanguage:fact.prompt.lang,answerLanguage:fact.correct.lang,instruction:isGrammarMode(fact.mode)?grammarTypes[fact.mode][2]:fact.mode==='article'?'اختر أداة التعريف في حالة الرفع':fact.correct.lang==='ar'?'اختر المعنى بالعربية':'اختر الكلمة بالألمانية',answers:[fact.correct.text],
    german:fact.entry.german,arabic:fact.entry.arabic_translations.join(' / '),explanation:fact.mode==='article'?'تُستعمل هذه الأداة مع الاسم المفرد في حالة الرفع.':'',hint:fact.hint},factId)
   items.push({...c,view,multipleChoice:true,make:(random:()=>number=Math.random)=>{
    const q=attach(c.make(),factId)
    return{...q,skill:view.skill,choices:questionChoices(fact,catalog,random).map(v=>v.text)}
   }})
  }
 }
 const byChapter=new Map<string,LearningItem[]>(),byId=new Map<string,LearningItem>()
 for(const item of items){const group=byChapter.get(item.chapter)??[];group.push(item);byChapter.set(item.chapter,group);byId.set(item.id,item)}
 return{items,byChapter,byId,chapters:practiceChapters(bank,pack),multipleChoice:items.filter(i=>i.multipleChoice)}
}

export function balancedSelection(pool:LearningItem[],count:number|'all',evidence:ReadonlyMap<string,Evidence>,now:number,seed:number){
 const groups=questionGroups(pool),ranked=adaptiveRound(groups,'all',evidence,now,seed) as LearningItem[]
 const buckets={due:[]as LearningItem[],weak:[]as LearningItem[],new:[]as LearningItem[],maintenance:[]as LearningItem[]}
 for(const item of ranked){const e=evidence.get(item.id);buckets[!e?'new':e.due<=now?'due':e.errors&&!e.resolved?'weak':'maintenance'].push(item)}
 const pattern=['due','new','weak','maintenance','new','due','new','weak','maintenance','new']as const
 const size=count==='all'?ranked.length:Math.min(count,ranked.length),result:LearningItem[]=[]
 while(result.length<size){const order=[...new Set([pattern[result.length%pattern.length],...pattern])];const bucket=order.find(k=>buckets[k].length);if(!bucket)break;result.push(buckets[bucket].shift()!)}
 return result
}
