import {AnswerAnalytics} from './AnswerAnalytics'
import {analyticsQuestionIndex,legacyAnswers,legacyMistakeEvidence} from './answer-analytics'
import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react'
import {Icon} from './icons'
import type {PersonalQuiz} from './personal-quiz'
import {feedbackExamples} from './pilot'
import type {StudyPack,StudyQuestion} from './study-content'
import {checkStudyAnswer} from './study-engine'
import {buildEvidence} from './learning-model'
import {buildLearningLibrary,balancedSelection,type ExplanationSupplement,type QuestionFeedback} from './learning-library'
import {newFocusSession,loadFocus,loadFocusHistory,startFocus,answerFocus,advanceFocus,focusMistakes,mistakeMastery,loadPastFocus,loadFocusArchives,resumeFocus,type FocusArchive,type FocusSession,type TestSummary} from './focus-session'
import {loadPracticePreferences} from './practice'
import {loadStudyProgress,type StudyEvent} from './study-progress'
import {StudyBackup} from './StudyProgress'
import {loadPracticeSession} from './practice-session'
import {useLegacySession} from './useLegacySession'
import {readLocal,writeLocal} from './storage'
import {selectLegacySession} from './legacy-session'
import {isCorrect,shuffle} from './quiz'

export type SimpleScreen='home'|'setup'|'mistakes'|'questions'|'test'|'test-results'|'test-review'|'analytics'
const n=new Intl.NumberFormat('ar-u-nu-arab'),num=(v:number)=>n.format(v)
const choices=[10,20,30,50,'all']as const
const answerLang=(q:Pick<StudyQuestion,'type'|'answerLanguage'>)=>q.answerLanguage??(['reading','flashcard'].includes(q.type)?'ar':'de')
export function Text({value,lang='de'}:{value:string;lang?:'ar'|'de'}){return <bdi lang={lang} dir={lang==='de'?'ltr':'rtl'}>{value}</bdi>}
export function ChapterLabel({chapter}:{chapter:string}) {
  const match = /^(A[12]):([1-9]|1[0-2])$/.exec(chapter)
  return match ? <span className="question-chapter-label"><bdi dir="ltr">{match[1]}</bdi> — الفصل {num(Number(match[2]))}</span> : null
}
export function ArabicExplanation({text}:{text:string}) {
  return <div lang="ar" dir="rtl" className="answer-explanation">{text.split(/\n{2,}/u).map((paragraph,index)=>
    <p key={index}>{paragraph.split(/(«[^»]+»)/u).map((segment,part)=>
      /^«[^»]+»$/u.test(segment)&&! /\p{Script=Arabic}/u.test(segment)
        ? <bdi key={part} lang="de" dir="ltr">{segment}</bdi> : segment)}</p>)}
  </div>
}
type AnswerCardQuestion = Pick<StudyQuestion, 'id'|'chapter'|'type'|'prompt'|'promptLanguage'|'answerLanguage'|'hint'|'answers'|'explanation'|'instruction'|'optionFeedback'>
export function AnswerCard({q,selected}:{q:AnswerCardQuestion;selected?:string}) {
  const option=selected&&Object.hasOwn(q.optionFeedback??{},selected)?q.optionFeedback?.[selected]:undefined
  return <article className="answer-card">
    <ChapterLabel chapter={q.chapter}/>
    <p className="answer-question"><Text value={q.prompt} lang={q.promptLanguage}/></p>
    {q.hint&&<p><Text value={q.hint.text} lang={q.hint.lang}/></p>}
    {q.type==='reading'&&<p>{q.instruction}</p>}
    {selected&&<p className="selected-answer">الإجابة المختارة · <Text value={selected} lang={answerLang(q)}/></p>}
    <p className="answer-correct">الإجابة الصحيحة · <Text value={q.answers.join(' / ')} lang={answerLang(q)}/></p>
    {q.explanation&&<ArabicExplanation text={q.explanation}/>}
    {option&&<ArabicExplanation text={option}/>}
  </article>
}
function preferences() {
  const old = loadPracticePreferences(readLocal('practice-preferences'), readLocal('quiz-settings'))
  let saved
  try { saved = JSON.parse(readLocal('simple-test-preferences') ?? 'null') } catch { /* Keep defaults. */ }
  const chapterIds = ['A1', 'A2'].flatMap(level => Array.from({length:12}, (_, i) => level + ':' + (i + 1)))
  const previous = saved?.chapters ?? old.chapters
  const selected = Array.isArray(saved?.selected) ? saved.selected : chapterIds.filter(id => {
    const list = previous[id.split(':')[0]]
    return !Array.isArray(list) || list.includes(id)
  })
  return {selected: [...new Set<string>(selected.filter((id: string) => chapterIds.includes(id)))],
    count: (choices.includes(saved?.count) ? saved.count : old.count) as typeof choices[number]}
}

export function SimpleLearning({screen,navigate,bank,pack,loading,openImport,supplement,feedback}:{screen:SimpleScreen;navigate:(s:SimpleScreen)=>void;bank:PersonalQuiz|null;pack:StudyPack|null;loading:boolean;openImport:()=>void;supplement?:ExplanationSupplement;feedback?:QuestionFeedback[]}){
 const[prefs,setPrefs]=useState(preferences),[events,setEvents]=useState<StudyEvent[]>([]),[session,setSession]=useState<FocusSession|null>(null),[viewedResult,setViewedResult]=useState<FocusSession|null>(null),[history,setHistory]=useState<TestSummary[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[reviewMode,setReviewMode]=useState<'study'|'test'>('study'),[shown,setShown]=useState(30),[browserLevel,setBrowserLevel]=useState<'A1'|'A2'>('A1'),[opened,setOpened]=useState<Record<string,number>>({}),[oldPractice,setOldPractice]=useState(false)
 const lock=useRef(false),heading=useRef<HTMLHeadingElement>(null),questionHeading=useRef<HTMLHeadingElement>(null)
 const legacy=useLegacySession(bank,true)
 const library=useMemo(()=>buildLearningLibrary(bank,pack,true,supplement,feedback),[bank,pack,supplement,feedback])
 const evidence=useMemo(()=>screen==='setup'?buildEvidence(events):new Map(),[events,screen])
 const questionIndex=useMemo(()=>analyticsQuestionIndex(library),[library])
 const savedLegacy=useMemo(()=>legacy.snapshot?[...legacy.sessions,legacy.snapshot]:legacy.sessions,[legacy.sessions,legacy.snapshot])
 const legacyDetails=useMemo(()=>legacyAnswers(savedLegacy,questionIndex),[savedLegacy,questionIndex])
 const legacyItems=useMemo(()=>{
  const found=new Map<string,AnswerCardQuestion>()
  for(const row of legacyDetails){
    if(row.correct||row.chapter)continue
    const q=row.question
    const answer=q.choices.find(c=>c.id===q.correctId)!
    // A frozen answer can be read even when its chapter is unknown. It cannot
    // be started as a new graded question without valid chapter provenance.
    found.set(row.questionId,{id:row.questionId,chapter:'',type:'vocabulary',
      prompt:q.prompt.text,promptLanguage:q.prompt.lang,answerLanguage:answer.lang,answers:[answer.text],
      instruction:'',explanation:'',hint:q.hint})
  }
  return found
 },[legacyDetails])
 const reviewing=screen==='mistakes'
 const historicalMistakes=useMemo(()=>legacyMistakeEvidence(legacyDetails),[legacyDetails])
 const mastery=useMemo(()=>reviewing?mistakeMastery([...events,...historicalMistakes.graded],historicalMistakes.seeds):new Map<string,{active:boolean}>(),[events,historicalMistakes,reviewing])
 const activeMistakes=useMemo(()=>[...mastery].filter(([,v])=>v.active).flatMap(([id])=>{const item=library.byId.get(id);return item?[item.view]:legacyItems.has(id)?[legacyItems.get(id)!]:[]}),[mastery,library,legacyItems])
 const cardReviews=useMemo(()=>{
  const pending=new Set<string>()
  if(reviewing)for(const event of events) {
    if(event.result==='missed')pending.add(event.questionId)
    if(event.result==='known')pending.delete(event.questionId)
  }
  return [...pending].filter(id=>!mastery.get(id)?.active)
 },[events,reviewing,mastery])
 const unavailableMistakes=useMemo(()=>[...mastery].filter(([id,v])=>v.active&&!library.byId.has(id)&&!legacyItems.has(id)).length,[mastery,library,legacyItems])
  const testMistakes=useMemo(()=>activeMistakes.filter(q=>library.byId.get(q.id)?.multipleChoice),[activeMistakes,library,legacyItems])
 const chapters=library.chapters
 const selected=useMemo(()=>chapters.filter(c=>prefs.selected.includes(c.id)).map(c=>c.id),[chapters,prefs.selected])
 const eligible=useMemo(()=>selected.flatMap(id=>(library.byChapter.get(id)??[]).filter(c=>c.multipleChoice)),[library,selected])
 const available=useMemo(()=>new Set(eligible.map(c=>c.key)).size,[eligible])
 const requested=prefs.count==='all'?available:prefs.count,actual=Math.min(requested,available)
 useEffect(()=>{writeLocal('simple-test-preferences',JSON.stringify(prefs))},[prefs])
 useEffect(()=>{
   let live=true
   void Promise.allSettled([loadStudyProgress(),loadFocus(),loadFocusHistory(),loadPracticeSession(false)]).then(([progress,active,summaries,old])=>{
     if(!live)return
     if(progress.status==='fulfilled')setEvents(progress.value)
     if(active.status==='fulfilled')setSession(active.value)
     if(summaries.status==='fulfilled')setHistory(summaries.value)
     if(old.status==='fulfilled')setOldPractice(Boolean(old.value&&old.value.position.index<old.value.plan.items.length))
     if([progress,active,summaries,old].some(result=>result.status==='rejected'))
       setError('تعذّر فتح بعض السجلات المحفوظة. يعرض التطبيق السجلات التي أمكن قراءتها.')
     setReady(true)
   })
   return()=>{live=false}
 },[])
 useEffect(()=>{heading.current?.focus({preventScroll:true});window.scrollTo(0,0)},[screen])
 useEffect(()=>{if(screen==='test'&&location.hash==='#/test'&&session?.finished)navigate('test-results')},[screen,session?.finished])
 async function refreshEvents(){try{setEvents(await loadStudyProgress())}catch{setError('تعذّر تحديث سجل التقدم.')}}
 useEffect(()=>{window.addEventListener('german-quiz:progress',refreshEvents);return()=>window.removeEventListener('german-quiz:progress',refreshEvents)},[])
 async function install(items:StudyQuestion[],kind:FocusSession['kind']){
  if(!items.length)return
  if(session&&!session.finished&&!window.confirm('سيُحفظ الاختبار غير المكتمل في الأرشيف قبل بدء اختبار جديد. هل تريد المتابعة؟'))return
  await startFocus(newFocusSession(items,kind,'focus:'+crypto.randomUUID()));setSession(await loadFocus());setViewedResult(null);navigate('test')
 }
 async function run(work:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await work()}catch{setError('تعذّر حفظ الاختبار. لم تُحذف البيانات السابقة؛ تحقق من المساحة المتاحة وأعد المحاولة.')}finally{lock.current=false;setBusy(false)}}
 async function start(){await run(async()=>{const picked=balancedSelection(eligible,prefs.count,evidence,Date.now(),crypto.getRandomValues(new Uint32Array(1))[0]);const items:StudyQuestion[]=[];for(const[item,i]of picked.map((item,i)=>[item,i]as const)){const q=item.make();items.push({...q,choices:shuffle(q.choices!)});if(i%40===0)await new Promise(r=>setTimeout(r,0))}await install(items,'normal')})}
 async function select(choice:string){if(!session)return;await run(async()=>{const updated=await answerFocus(session.id,session.cursor,choice);setSession(updated.session);if(updated.event)setEvents(previous=>previous.some(event=>event.id===updated.event!.id)?previous:[...previous,updated.event!])})}
 async function next(stop=false){if(!session)return;await run(async()=>{const updated=await advanceFocus(session.id,session.cursor,stop);setSession(updated.session);setHistory(updated.history);if(updated.session.finished){setViewedResult(null);if(location.hash==='#/test')navigate('test-results')}})}
 async function retest(){if(displayed)await run(()=>install(focusMistakes(displayed).filter(q=>q.choices?.length).map(q=>({...q,choices:shuffle(q.choices!)})),'retry'))}
 const back=<a className="back-link" href="#/"><Icon name="right" size={18}/>العودة للرئيسية</a>
 const label={home:'تعلّم بخطوة بسيطة',setup:'إعداد الاختبار',mistakes:'مراجعة الأخطاء',questions:'جميع الأسئلة',test:'الاختبار','test-results':'نتيجة الاختبار','test-review':'أخطاء هذا الاختبار',analytics:'تحليل أدائي'}[screen]
 const current=session&&!session.finished?session.items[session.queue[session.cursor]]:null
 const submitted=session?.answers[session.cursor]
 const selectedNote=current&&submitted&&!submitted.correct&&Object.hasOwn(current.optionFeedback??{},submitted.choice)?current.optionFeedback?.[submitted.choice]:undefined
 const lastWrong=useMemo(()=>{const map=new Map<string,string>();if(reviewing){for(const row of legacyDetails){const choice=row.question.choices.find(c=>c.id===row.choice);if(!row.correct&&choice)map.set(row.questionId,choice.text)}for(const e of events)if(e.result==='incorrect'&&e.answer)map.set(e.questionId,e.answer)}return map},[events,reviewing,legacyDetails])
 const recent=history.filter(summary=>summary.kind!=='assessment').slice(-3).reverse()
 const displayed=viewedResult??session
  const result=displayed?{total:displayed.answers.length,correct:displayed.answers.filter(a=>a.correct).length,wrong:displayed.answers.filter(a=>!a.correct).length}:null
  useEffect(()=>{questionHeading.current?.focus({preventScroll:true})},[session?.id,session?.cursor])
 return <main className="simple-main site-container" id="learning-main" data-screen={screen}>
  {screen!=='home'&&<div className="simple-page-heading">{back}<h1 ref={heading} tabIndex={-1}>{label}</h1></div>}
  {error&&<p className="simple-error" role="alert">{error}</p>}
  {screen==='home'&&<><div className="home-intro"><span className="section-label">مساحة تعلّمك الخاصة</span><h1 ref={heading} tabIndex={-1}>ماذا تريد أن تتعلّم اليوم؟</h1><p>اختبر نفسك، تعلّم من أخطائك، أو راجع بهدوء.</p></div>
   <div className="home-actions" aria-label="أقسام التعلّم">
    {([['setup','الاختبار','إعداد الاختبار وبدؤه','list'],['mistakes','مراجعة الأخطاء','مذاكرة الأخطاء وإعادة الاختبار','retry'],['questions','جميع الأسئلة','تصفح الأسئلة والإجابات والشروحات','book'],['analytics','تحليل أدائي','تتبّع تقدّمك وحدّد ما تراجعه','progress']]as const).map(([to,title,subtitle,icon])=><a className="home-action" href={'#/'+to} key={to}><span className="home-action-icon"><Icon name={icon} size={30}/></span><h2>{title}</h2><p>{subtitle}</p><span className="home-action-arrow"><Icon name="left"/></span></a>)}
   </div>
   {!loading&&(!bank||!pack)&&<p className="home-data-note">ابدأ بملف المحتوى الخاص بك. <button className="text-button" onClick={openImport}>استيراد المحتوى</button></p>}
   {session&&!session.finished&&<div className="resume-line"><span>لديك اختبار غير مكتمل</span><button className="text-button" onClick={()=>navigate('test')}>متابعة الاختبار</button><button className="text-button" onClick={()=>navigate('setup')}>بدء اختبار جديد</button></div>}
   {(oldPractice||legacy.attempt&&!legacy.attempt.finished)&&<p className="legacy-line">لديك جلسة سابقة محفوظة. <a href={oldPractice?'#/practice':'#/quiz'}>متابعة الجلسة السابقة</a></p>}
   {legacy.issue&&<p className="legacy-line" role="status">{legacy.issue}</p>}
  </>}
  {loading||!ready?<p role="status" className="simple-loading">جارٍ فتح المحتوى المحفوظ…</p>:<>
   {screen==='analytics'&&<AnswerAnalytics events={events} history={history} legacy={savedLegacy} library={library}/>}
   {screen==='setup'&&<section className="test-setup panel">
    <details className="chapter-picker chapter-select">
      <summary><span>الفصول</span><strong aria-live="polite">تم اختيار {num(selected.length)} من {num(chapters.length)} فصلًا</strong><Icon name="down" size={18}/></summary>
      <div className="chapter-tools">
        {(['A1','A2'] as const).map(level=><button key={level} className="text-button" onClick={() => setPrefs(p => ({...p, selected: [...new Set([...p.selected, ...chapters.filter(c=>c.level===level).map(c=>c.id)])]}))}>تحديد كل <bdi dir="ltr">{level}</bdi></button>)}
        <button className="text-button" onClick={() => setPrefs(p => ({...p, selected: chapters.map(c=>c.id)}))}>تحديد الكل</button>
        <button className="text-button" onClick={() => setPrefs(p => ({...p, selected: []}))}>إلغاء التحديد</button>
      </div>
      <div className="chapter-checkboxes">{chapters.map(c=><label key={c.id} className={selected.includes(c.id)?'selected':''}>
        <input type="checkbox" checked={selected.includes(c.id)} onChange={e => {
          const checked=e.currentTarget.checked
          setPrefs(p=>({...p,selected:checked?[...p.selected,c.id]:p.selected.filter(id=>id!==c.id)}))
        }}/>
        <span><ChapterLabel chapter={c.id}/><small lang="de" dir="ltr">{c.title}</small></span>
      </label>)}</div>
    </details>
    <fieldset className="count-picker"><legend>عدد الأسئلة</legend>{choices.map(count=><label key={count} className={prefs.count===count?'selected':''}><input type="radio" name="test-count" checked={prefs.count===count} onChange={()=>setPrefs(p=>({...p,count}))}/>{count==='all'?'الكل':num(count)}</label>)}</fieldset>
    <div className="start-area"><div><p>{num(available)} سؤالًا مؤهلًا من الفصول المحددة</p>{actual<requested&&<small role="status">المتاح {num(actual)} فقط؛ سيبدأ الاختبار بهذا العدد دون تكرار.</small>}<small>مزيج تلقائي من أسئلة الاختيار المتعدد، دون مؤقّت.</small></div><button className="button primary" disabled={busy||!selected.length||!available} onClick={()=>void start()}>{busy?'جارٍ تجهيز الاختبار…':'بدء الاختبار'}<Icon name="left"/></button></div>
    {!bank&&!pack&&<p>استورد ملف المحتوى من الزر أعلى الصفحة.</p>}
   </section>}
   {screen==='test'&&current&&session&&<section className="focus-test">
    <div className="test-progress"><span>{num(session.cursor+1)} / {num(session.queue.length)}</span><progress aria-label="تقدم الاختبار" max={session.queue.length} value={session.cursor+(submitted?1:0)}/></div>
    <article className="panel focus-question"><p className="section-label"><ChapterLabel chapter={current.chapter}/></p><p className="question-task">{current.instruction}</p><h2 ref={questionHeading} tabIndex={-1} key={current.id+session.cursor}><Text value={current.prompt} lang={current.promptLanguage}/></h2>{current.hint&&<p><Text value={current.hint.text} lang={current.hint.lang}/></p>}
     <div className="focus-choices" role="group" aria-label="خيارات الإجابة">{current.choices!.map((c,i)=>{const right=Boolean(submitted&&checkStudyAnswer(current,c)),wrong=Boolean(submitted?.choice===c&&!right);return <button className={'focus-choice'+(right?' correct':wrong?' wrong':'')} key={c} aria-disabled={Boolean(submitted)||busy} onClick={()=>!submitted&&!busy&&void select(c)}><span>{num(i+1)}</span><Text value={c} lang={answerLang(current)}/>{right?<Icon name="check"/>:wrong?<Icon name="cross"/>:null}</button>})}</div>
     {submitted&&<div className={'focus-feedback '+(submitted.correct?'positive':'negative')}><div role="status"><strong>{submitted.correct?'إجابة صحيحة':'إجابة غير صحيحة'}</strong>{!submitted.correct&&<p className="selected-answer">إجابتك · <Text value={submitted.choice} lang={answerLang(current)}/></p>}<p>الإجابة الصحيحة · <Text value={current.answers.join(' / ')} lang={answerLang(current)}/></p>{current.origin==='vocabulary'&&<p className="feedback-meaning"><Text value={current.german}/> · <Text value={current.arabic} lang="ar"/></p>}{current.explanation&&<ArabicExplanation text={current.explanation}/>}
      {selectedNote&&<section className="option-feedback"><h3>لماذا لم تناسب إجابتك السؤال؟</h3><ArabicExplanation text={selectedNote}/></section>}
      {feedbackExamples(current.examples??[],current.chapter.startsWith('A1:')?'A1':'A2').slice(0,1).map(ex=><section className="session-examples" key={ex.german}><h3>مثال في السياق</h3><p lang="de" dir="ltr">{ex.german}</p>{ex.arabic&&<p lang="ar" dir="rtl">{ex.arabic}</p>}</section>)}
     </div><button className="button primary" disabled={busy} onClick={()=>void next()}>السؤال التالي<Icon name="left"/></button></div>}
    </article>{session.kind==='mistakes'&&<button className="text-button finish-review" disabled={busy} onClick={()=>void next(true)}>إنهاء المراجعة الآن وحفظ الأخطاء المتبقية</button>}
   </section>}
   {screen==='test'&&!session&&<p>لا يوجد اختبار محفوظ. <a href="#/setup">إعداد اختبار</a></p>}
   {screen==='test-results'&&displayed&&result&&<section className="panel simple-results"><span className="result-icon"><Icon name="check" size={32}/></span><h2>{!result.total?'انتهت الجلسة دون إجابات':result.wrong?'نتيجة هذه الجلسة':'أحسنت، جميع الإجابات صحيحة'}</h2><strong className="simple-accuracy">{num(result.total?Math.round(result.correct/result.total*100):0)}٪</strong><dl className="result-stats"><div><dt>الصحيحة</dt><dd>{num(result.correct)}</dd></div><div><dt>الخاطئة</dt><dd>{num(result.wrong)}</dd></div><div><dt>{displayed.kind==='mistakes'?'المحاولات':'الأسئلة'}</dt><dd>{num(result.total)}</dd></div></dl>{displayed.stoppedEarly&&<p>انتهت الجلسة مبكرًا؛ بقيت الأخطاء غير المتقنة في دفتر المراجعة.</p>}<div className="result-actions">{result.wrong>0&&<><button className="button secondary" onClick={()=>navigate('test-review')}>مراجعة الأخطاء</button><button className="button primary" disabled={busy} onClick={()=>void retest()}>إعادة اختبار الأخطاء</button></>}<a className="button secondary" href="#/">العودة للرئيسية</a></div></section>}
   {screen==='test-review'&&displayed&&<><p>هذه أخطاء الاختبار المعروض فقط.</p><div className="answer-list">{focusMistakes(displayed).slice(0,shown).map(q=><AnswerCard key={q.id} q={q} selected={displayed.answers.find(a=>!a.correct&&displayed.items[a.item].id===q.id)?.choice}/>)}</div>{focusMistakes(displayed).length>shown&&<button className="button secondary" onClick={()=>setShown(v=>v+30)}>تحميل المزيد</button>}<button className="button primary" disabled={busy||!focusMistakes(displayed).length} onClick={()=>void retest()}>إعادة اختبار الأخطاء</button></>}
   {screen==='mistakes'&&<>{unavailableMistakes>0&&<p className="quiet-note" role="status">يوجد {num(unavailableMistakes)} سجل خطأ محفوظ لا يتوفر له سؤال مطابق في ملف المحتوى. يمكن مراجعة الجلسات المحفوظة من زر ملف المحتوى.</p>}<div className="review-tabs" role="group" aria-label="طريقة مراجعة الأخطاء"><button aria-pressed={reviewMode==='study'} onClick={()=>setReviewMode('study')}>مذاكرة الأخطاء</button><button aria-pressed={reviewMode==='test'} onClick={()=>setReviewMode('test')}>اختبار الأخطاء</button></div>
    {activeMistakes.length?<>{reviewMode==='study'?<><p className="quiet-note">{num(activeMistakes.length)} سؤالًا للمراجعة. تصفح الإجابات لا يغيّر سجل الإتقان.</p><div className="answer-list">{activeMistakes.slice(0,shown).map(q=><AnswerCard q={q} key={q.id} selected={lastWrong.get(q.id)}/>)}</div>{shown<activeMistakes.length&&<button className="button secondary" onClick={()=>setShown(v=>v+30)}>تحميل المزيد</button>}</>:<section className="panel review-start"><Icon name="retry" size={32}/><h2>تدرّب على جميع الأخطاء المؤهلة</h2><p>{num(testMistakes.length)} سؤالًا، دون اختيار عدد.</p><p>تعود الإجابة الخاطئة إلى نهاية الجولة، بحد أقصى ثلاث محاولات لكل سؤال. لا يغادر السؤال الدفتر إلا بعد إجابتين صحيحتين متتاليتين.</p>{testMistakes.length<activeMistakes.length&&<p>بعض الأخطاء القديمة تحتاج طريقة إجابة مختلفة؛ بقيت متاحة للمذاكرة دون تحويلها إلى اختيارات غير آمنة.</p>}<button className="button primary" disabled={busy||!testMistakes.length} onClick={()=>void run(()=>install(testMistakes.map(q=>library.byId.get(q.id)!.make()),'mistakes'))}>بدء اختبار الأخطاء</button></section>}</>:<div className="panel simple-empty"><Icon name="check" size={32}/><h2>{unavailableMistakes?'لا توجد أخطاء قابلة للعرض في المحتوى المختار':'لا توجد أخطاء نشطة'}</h2><p>ستظهر هنا الأسئلة التي تحتاج إلى مراجعة.</p><a href="#/setup" className="button primary">ابدأ اختبارًا</a></div>}</>}
   {screen==='mistakes'&&reviewMode==='study'&&cardReviews.length>0&&<details className="recent-tests">
     <summary>بطاقات اخترت مراجعتها ({num(cardReviews.length)})</summary>
     <p>تقييم البطاقات الذاتي محفوظ في سجل المراجعة. الدقة والإتقان في التحليل يستندان إلى الإجابات المصححة.</p>
     <div className="answer-list">{cardReviews.slice(0,shown).map(id=>{
       const item=library.byId.get(id)
       return item&&<AnswerCard key={id} q={item.view}/>
     })}</div>
     {cardReviews.length>shown&&<button className="button secondary" onClick={()=>setShown(v=>v+30)}>تحميل المزيد</button>}
   </details>}
   {screen==='questions'&&<><div className="level-picker browser-level" role="group" aria-label="مستوى الأسئلة">{(['A1','A2']as const).map(level=><button aria-pressed={browserLevel===level} key={level} onClick={()=>setBrowserLevel(level)}><bdi dir="ltr">{level}</bdi></button>)}</div><div className="question-chapters">{library.chapters.filter(c=>c.level===browserLevel).map(c=>{const items=library.byChapter.get(c.id)??[];return <details key={c.id} onToggle={e=>{const open=e.currentTarget.open;setOpened(v=>({...v,[c.id]:open?(v[c.id]||20):0}))}}><summary><span>الفصل {num(c.number)}<small lang="de" dir="ltr">{c.title}</small></span><span>{num(items.length)} سؤالًا<Icon name="down" size={18}/></span></summary>{opened[c.id]&&<div className="answer-list">{items.slice(0,opened[c.id]).map(item=><AnswerCard q={item.view} key={item.id}/>)}{opened[c.id]<items.length&&<button className="button secondary" onClick={()=>setOpened(v=>({...v,[c.id]:v[c.id]+20}))}>تحميل المزيد</button>}</div>}</details>})}</div></>}
   {(screen==='setup'||screen==='test-results')&&recent.length>0&&<details className="recent-tests"><summary>آخر ثلاثة اختبارات</summary><ul>{recent.map(h=><li key={h.id}><span>{num(h.correct)} / {num(h.total)} · {new Date(h.time).toLocaleDateString('ar')}</span><button className="text-button" onClick={()=>void run(async()=>{const old=session?.id===h.id?session:await loadPastFocus(h.id);if(old){setViewedResult(old);navigate('test-results')}else setError('النتيجة محفوظة، لكن تفاصيل أسئلتها غير متاحة.')})}>عرض النتيجة</button></li>)}</ul></details>}
  </>}
 </main>
}

export function LearningDataTools({bank,pack,importControls}:{bank:PersonalQuiz|null;pack:StudyPack|null;importControls:ReactNode}){
 const[events,setEvents]=useState<StudyEvent[]>([]),[archives,setArchives]=useState<FocusArchive[]>([]),[error,setError]=useState('')
 const legacy=useLegacySession(bank,true)
 useEffect(()=>{void loadStudyProgress().then(setEvents).catch(()=>setError('تعذّر فتح سجل التقدم؛ لم تُحذف بياناتك.'));void loadFocusArchives().then(setArchives).catch(()=>setError('تعذّر فتح أرشيف الاختبارات.'))},[])
 async function resume(id:string,old=false){try{if(old){await selectLegacySession(id);location.hash='/quiz'}else{await resumeFocus(id);location.hash='/test';location.reload()}}catch{setError('تعذّر استئناف هذه الجلسة بأمان. بقيت محفوظة دون تغيير.')}}
 const older=[...legacy.sessions.filter(s=>!s.attempt.finished),...legacy.sessions.filter(s=>s.attempt.finished).slice(-3)]
 return <>{importControls}{error&&<p role="alert">{error}</p>}
 <details className="session-archive"><summary>الجلسات السابقة المحفوظة</summary><p>تبقى النتائج القديمة محفوظة. الجلسات التي يتعذّر استعادتها بأمان لا تُحذف.</p>{archives.filter(a=>!a.finished).map(a=><p key={a.id}><span>اختبار غير مكتمل · {new Date(a.time).toLocaleDateString('ar')}</span> <button className="text-button" onClick={()=>void resume(a.id)}>استئناف الاختبار المؤرشف</button></p>)}{older.map(s=><p key={s.id}><span>{s.attempt.finished?'نتيجة سابقة':'جلسة سابقة غير مكتملة'}</span> <button className="text-button" onClick={()=>void resume(s.id,true)}>{s.attempt.finished?'عرض النتيجة السابقة':'استئناف الجلسة السابقة'}</button></p>)}{legacy.issue&&<p role="status">{legacy.issue}</p>}</details>
 <StudyBackup vocabulary={bank?.dataset??null} pack={pack} events={events} update={e=>{setEvents(e);window.dispatchEvent(new Event('german-quiz:progress'))}}/></>
}
