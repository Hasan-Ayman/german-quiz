import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {relative,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {validateEducationPackage,maximumEducationBytes} from '../src/education-package.ts'
import {preparePersonalQuiz} from '../src/personal-quiz.ts'
import {buildLearningLibrary,cleanChoices,validateQuestionFeedback} from '../src/learning-library.ts'
import {checkStudyAnswer} from '../src/study-engine.ts'
import {makeStudyEvent} from '../src/study-progress.ts'
import {feedbackExamples} from '../src/pilot.ts'

const [originalFile,enrichedFile,output,reportFile]=process.argv.slice(2)
assert(originalFile&&enrichedFile&&output&&reportFile,'Provide both checkpoints and the private output and audit paths')
for(const path of [output,reportFile])assert(relative(process.cwd(),resolve(path)).startsWith('..'),'Private output belongs outside the repository')
const read=async file=>JSON.parse(await readFile(file,'utf8'))
const original=await read(originalFile),enriched=await read(enrichedFile)
assert.deepEqual(enriched.vocabulary,original.vocabulary)
assert.deepEqual(enriched.study,original.study)
const checked=validateEducationPackage(enriched)
const bank=await preparePersonalQuiz(checked.vocabulary)
const library=buildLearningLibrary(bank,checked.study,true,checked.explanations)
const catalog=bank.getExpandedCatalog('A2')
const byEntry=new Map()
for(const fact of catalog.facts.values()){
 const group=byEntry.get(fact.entry.id)??[]
 group.push(fact);byEntry.set(fact.entry.id,group)
}
const quote=value=>'«'+value+'»'
const genders={der:'المذكّر',die:'المؤنّث',das:'المحايد'}
const subjects={ich:'أنا',du:'أنتَ أو أنتِ للمفرد', 'er/sie/es':'ضمائر الغائب المفرد',wir:'نحن',ihr:'أنتم في الخطاب غير الرسمي','sie/Sie':'هم أو أنتم في الخطاب الرسمي'}
const endings={ich:'e',du:'st','er/sie/es':'t',wir:'en',ihr:'t','sie/Sie':'en'}
const signals={temporal:'متى أو كم مرة يحدث الفعل',lokal:'أين أو إلى أين يحدث الفعل',modal:'كيف يحدث الفعل',kausal:'لماذا يحدث الفعل'}
const classifications={
 regelmäßig:'في التصريف المنتظم يُبنى الماضي البسيط عادةً بعلامة te، مع مراعاة النهايات.',
 unregelmäßig:'تُحفظ الصيغ غير المنتظمة مع الفعل لأن قاعدة الأفعال المنتظمة وحدها لا تكفي لاشتقاقها.',
 stark:'في التصريف القوي يتغيّر غالبًا صوت العلة في جذر الفعل بين المصدر والماضي البسيط. وقد ينتهي اسم المفعول بـ «-en». احفظ الصيغ المسجّلة للفعل معًا.',
 gemischt:'في التصريف المختلط يجتمع تغيّر في الجذر مع نهايات الماضي التي نجدها في التصريف الضعيف. تساعد مقارنة المصدر وصيغة الماضي على رؤية التغيّر.',
 'ohne sich im Eintrag':'المدخل المعروض مكتوب من دون الضمير «sich». يصف السؤال شكل هذا المدخل فقط، ولا يحكم على جميع استعمالات الفعل.',
 trennbar:'في الجملة الرئيسية العادية بالمضارع تبقى البادئة المنفصلة في آخر الجملة، ويتصرّف الجزء الآخر.',
 untrennbar:'البادئة غير القابلة للفصل تبقى متصلة بالفعل في الجملة الرئيسية.',
 reflexiv:'يرتبط الاستعمال الانعكاسي بضمير انعكاسي يوافق الفاعل، مثل mich مع ich في حالة النصب.',
 Modalverb:'حين يصاحب الفعل الناقص فعلًا آخر في جملة رئيسية، يتصرّف الفعل الناقص ويأتي المصدر غالبًا في آخرها.',
 Hilfsverb:'يعمل الفعل المساعد مع صيغة فعل آخر لبناء زمن أو تركيب نحوي.',
}
function detail(fact){
 const {mode,entry,prompt,correct}=fact
 const word=quote(entry.german),answer=quote(correct.text),gloss=quote(entry.arabic_translations.join(' / '))
 const related=byEntry.get(entry.id)
 const companion=key=>related.find(f=>f.mode===key&&(!fact.chapters||f.chapters?.some(c=>fact.chapters.includes(c))))?.correct.text
 const gender=entry.article&&genders[entry.article]
 const noun=gender?' الاسم '+quote(entry.article+' '+entry.german)+' جنسُه النحوي '+gender+' في المفرد.':''
 const plural=companion('noun-plural')
 const perfect=companion('verb-perfect'),past=companion('verb-preterite')
 const options={}
 let text=''
 if(mode==='article'&&gender){
  text='أداة '+word+' هي '+answer+' لأن جنس الاسم النحوي '+gender+' في المفرد المرفوع. أدوات الرفع للمفرد هي «der» للمذكر، و«die» للمؤنث، و«das» للمحايد. احفظ الاسم مع أداته؛ الأداة قد تتغير بحسب الحالة الإعرابية.'
  if(plural)text+='\n\nجمعه المسجّل '+quote(plural)+'، وتُستعمل «die» مع الجمع المرفوع للأجناس الثلاثة.'
  for(const [option,label] of Object.entries(genders))if(option!==correct.text)options[option]='«'+option+'» أداة المفرد '+label+' في الرفع. الاسم هنا '+gender+'، ولذلك يوافقه '+answer+'.'
 } else if(['de-ar','ar-de','verb','adjective'].includes(mode)){
  text=word+' يقابل '+gloss+' في هذا السؤال.'+noun
  if(plural)text+=' صيغة الجمع المسجلة هي '+quote(plural)+'.'
  if(past&&perfect)text+='\n\nللتعرّف على الفعل في الماضي، يرد في الماضي البسيط بصيغة '+quote(past)+' وفي الماضي المركب بصيغة '+quote(perfect)+'.'
  else if(companion('adjective-comparative')&&companion('adjective-superlative'))text+='\n\nللمقارنة تُستعمل '+quote(companion('adjective-comparative'))+'، وللتفضيل '+quote(companion('adjective-superlative'))+'.'
  else if(!noun&&!plural){
   const example=feedbackExamples(entry.examples,fact.chapters?.[0]?.startsWith('A1:')?'A1':'A2')
    .find(e=>e.arabic&&e.german.length+(e.arabic?.length??0)<=240&&
      (entry.arabic_translations.length===1||e.arabic.includes(correct.lang==='ar'?correct.text:prompt.text)))
   if(!example)return null
   text+='\n\nاقرأ المفردة في هذا المثال '+quote(example.german)+' وترجمته '+quote(example.arabic)+'.'
  }
 } else if(mode==='verb-present'){
  const pronoun=prompt.text.split(' · ').at(-1)
  if(!subjects[pronoun])return null
  text='مع '+quote(pronoun)+' ('+subjects[pronoun]+') يأتي فعل '+word+' في المضارع بصيغة '+answer+'.'
  const root=entry.german.endsWith('en')?entry.german.slice(0,-2):''
  if(root&&correct.text===root+endings[pronoun])text+=' في هذه الصيغة يظهر الجذر '+quote(root)+' متبوعًا بالنهاية '+quote('-'+endings[pronoun])+'.'
  else text+=' احفظ هذه الصيغة مع الضمير، لأن هذا الجواب لا يُستخرج هنا بمجرد إلحاق النهاية المعتادة بمصدر الفعل.'
  const contrasts=related.filter(f=>f.mode===mode&&f.correct.text!==correct.text).slice(0,2)
  if(contrasts.length)text+='\n\nللمقارنة، '+contrasts.map(f=>quote(f.prompt.text.split(' · ').at(-1))+' يأخذ '+quote(f.correct.text)).join('، و')+'.'
  for(const f of contrasts)if(fact.distractors.some(d=>d.text===f.correct.text))
    options[f.correct.text]=quote(f.correct.text)+' توافق '+quote(f.prompt.text.split(' · ').at(-1))+' في تصريف هذا الفعل. الضمير المطلوب '+quote(pronoun)+' وصيغته '+answer+'.'
 } else if(mode==='noun-plural'){
  text=word+' مفرد و'+answer+' جمعه المسجّل.'+noun+' المطلوب هنا كتابة صيغة الجمع كاملة. «die» أداة الجمع في حالة الرفع، حتى عندما تكون أداة المفرد «der» أو «das».'
 } else if(mode==='noun-singular'){
  text='صيغة '+quote(prompt.text)+' تدل على الجمع المرفوع. يقابلها الاسم المفرد '+answer+'.'+noun+' لا نستنتج جنس المفرد من «die» في صيغة الجمع؛ لجميع الأجناس أداة الجمع نفسها في الرفع.'
 } else if(mode==='noun-plural-availability'){
  text='حالة خانة الجمع للاسم '+word+' هي '+answer+'. وجود صيغة في القائمة يسمح بسؤال عنها. غياب الصيغة من القائمة وحده لا يثبت أن الاسم لا يمكن جمعه في الألمانية.'
 } else if(mode==='verb-preterite'){
  text=answer+' صيغة الماضي البسيط للفعل '+word+'. الماضي البسيط صيغة متصرّفة تحمل معنى الماضي في الفعل نفسه.'+(perfect?' قارنها بالماضي المركّب '+quote(perfect)+'، الذي يستخدم فعلًا مساعدًا.':'')
 } else if(mode==='verb-perfect'){
  text='يُبنى الماضي المركّب لهذا الفعل '+word+' من فعل مساعد وصيغة «Partizip II». تظهر الصيغة الكاملة هنا '+answer+'. في الجملة الرئيسية يتصرّف الفعل المساعد وتأتي الصيغة غير المتصرّفة عادةً في آخرها.'
 } else if(mode==='verb-infinitive'){
  text='صيغتا الماضي في السؤال تعودان إلى المصدر '+answer+'، ومعناه '+gloss+'. المصدر هو الصيغة التي نبحث بها عن الفعل، أما «Präteritum» و«Perfekt» فهما طريقتان للتعبير عن الماضي.'
 } else if(mode==='verb-auxiliary'||mode==='verb-participle'){
  if(!perfect)return null
  text='صيغة الماضي المركّب للفعل '+word+' هي '+quote(perfect)+'. '+answer+(mode==='verb-auxiliary'?' هو مصدر الفعل المساعد الذي يحمل التصريف في هذا التركيب.':' هي صيغة «Partizip II» التي تأتي مع الفعل المساعد، ولا تتغير هنا مع الضمير.')
 } else if(mode==='adjective-comparative'){
  text=answer+' صيغة المقارنة من '+word+' ('+gloss+'). نستخدم درجة المقارنة حين نقارن طرفين في هذه الصفة، ويمكن تقديم الطرف الثاني بلفظ «als».'
 } else if(mode==='adjective-superlative'){
  text=answer+' صيغة التفضيل المسجلة للصفة '+word+' ('+gloss+'). تدل درجة التفضيل على أعلى درجة في المجموعة.'+(correct.text.startsWith('am ')?' التركيب هنا «am» مع صيغة التفضيل، ويستعمل بعد الفعل حين نصف الدرجة.':'')
 } else if(mode==='adverb-category'&&signals[correct.text]){
  text=word+' يعني '+gloss+'. تصنيفه '+answer+' لأنه يجيب عن سؤال '+signals[correct.text]+'.'
  for(const option of fact.distractors)if(signals[option.text])options[option.text]='هذا التصنيف يبيّن '+signals[option.text]+'، بينما الظرف في السؤال يبيّن '+signals[correct.text]+'.'
 } else if(mode==='verb-classification'&&classifications[correct.text]){
  text='تصنيف الفعل '+word+' في الفئة التي يسأل عنها التمرين هو '+answer+'. '+classifications[correct.text]
 } else if(mode.endsWith('-context')){
  text='الجملة '+answer+' تطابق الترجمة '+quote(prompt.text)+'. المفردة المقصودة '+word+' ومعناها '+gloss+'. اقرأ الجملة كاملة لتمييز الاستعمال في السياق.'
 } else if(mode.endsWith('-synonym')||mode.endsWith('-antonym')){
  const relatedMeaning=mode.endsWith('-synonym')?'مشابه':'مقابل'
  text='معنى '+word+' هنا '+gloss+'. يذكر السؤال '+answer+' بوصفه لفظًا ذا معنى '+relatedMeaning+' في هذا الاستعمال. اعتمد على المعنى المحدد في السؤال، فقد تتغير العلاقة بتغيّر السياق.'
 }
 return text?{text,...(Object.keys(options).length?{options}:{})}:null
}
const feedback=[],unchanged=[],limited=[],seen=new Set()
const push=(questionId,prompt,answer,note)=>{
 const key=JSON.stringify([questionId,prompt,answer])
 if(seen.has(key))return
 seen.add(key)
 feedback.push({questionId,prompt,answer,...note,method:'bound_fact_rules_v1'})
}
const visitedFacts=new Set()
for(const {view,item, id} of library.items.map(item=>({view:item.view,item,id:item.id}))){
 if(view.origin==='vocabulary'&&id.startsWith('study:')){
  const factId=id.slice(6,-view.chapter.length-1)
  const fact=catalog.facts.get(factId)
  assert(fact,'Unmatched vocabulary fact')
  if(visitedFacts.has(factId))continue
  visitedFacts.add(factId)
  const note=detail(fact)
  if(note)push(factId,view.prompt,view.answers[0],note)
  else {
   // Keep the established glossary explanation, with a transparent audit of
   // facts for which no reliably richer linguistic evidence was available.
   if(view.explanation)push(factId,view.prompt,view.answers[0],{text:view.explanation})
   limited.push({id:factId,reason:view.explanation?'Existing explanation retained; insufficient specific evidence for a richer note':'No reliable explanation'})
  }
 } else if(view.explanation) unchanged.push(id)
 else if(item.multipleChoice)limited.push({id,reason:'No verified exercise rationale'})
}
const {explanations,...payload}=enriched
const final={...payload,feedback}
const validated=validateEducationPackage(final)
validateQuestionFeedback(validated.feedback,bank,validated.study)
const ready=buildLearningLibrary(bank,validated.study,true,undefined,validated.feedback)
assert.deepEqual(validated.vocabulary,checked.vocabulary)
assert.deepEqual(validated.study,checked.study)
assert.equal(ready.items.length,library.items.length)
assert.equal(ready.byId.size,ready.items.length,'Duplicate eligible question IDs')
const chapters=new Set(validated.study.chapters.map(c=>c.id))
assert.equal(chapters.size,24)
const displayFacts=new Set()
const missing=[],eligibleChoices=[]
for(const item of ready.items){
 const q=item.view
 assert(chapters.has(q.chapter),'Unknown chapter')
 assert(!/[\u0000\uFFFD]/u.test([q.prompt,q.german,q.arabic,q.explanation,...q.answers].join('')))
 if(!q.explanation)missing.push(q.id)
 displayFacts.add(JSON.stringify([q.origin==='vocabulary'&&q.id.startsWith('study:')?q.id.slice(6,-q.chapter.length-1):q.id,q.prompt,q.answers[0]]))
 if(!item.multipleChoice)continue
 const live=item.make(()=>.49)
 assert(cleanChoices(live),'Ineligible choice key')
 for(const choice of live.choices){
  makeStudyEvent(live,checkStudyAnswer(live,choice)?'correct':'incorrect','audit:validation',choice)
 }
 eligibleChoices.push(item)
}
assert([...seen].every(key=>displayFacts.has(key)),'Feedback mapping no longer points to an admitted fact')
const encoded=JSON.stringify(final)+'\n'
assert(Buffer.byteLength(encoded)<=maximumEducationBytes,'Canonical JSON exceeds import limit')
const report={bytes:Buffer.byteLength(encoded),sha256:createHash('sha256').update(encoded).digest('hex'),
 chapters:chapters.size,vocabulary:validated.vocabulary.entries.length,sourceRows:validated.vocabulary.sourceRows?.length,
 grammar:validated.study.lessons.length,activities:validated.study.questions.length,readings:validated.study.readingPassages?.length,
 examples:validated.vocabulary.entries.reduce((n,e)=>n+e.examples.length,0),eligibleViews:ready.items.length,
 eligibleChoices:eligibleChoices.length,distinctTestGroups:new Set(eligibleChoices.map(q=>q.key)).size,
 improved:feedback.length-limited.filter(r=>r.reason.startsWith('Existing')).length,answerSpecific:feedback.filter(r=>r.options).length,
 preservedExerciseExplanations:unchanged.length,missing:missing.length,limited:limited.length,
 limitations:limited,missingIds:missing,independentLinguisticReview:false,
 provenance:'Local deterministic instructional rules and previously approved facts. Existing exercise explanations retained.'}
await writeFile(output,encoded,{flag:'wx'})
await writeFile(reportFile,JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({...report,limitations:undefined,missingIds:undefined}))
