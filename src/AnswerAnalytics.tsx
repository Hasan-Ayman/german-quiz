import {useMemo, useState} from 'react'
import {analyzeAnswers, analyticsQuestionIndex, skillLabel} from './answer-analytics'
import type {LearningLibrary} from './learning-library'
import type {FrozenSession} from './legacy-session'
import type {TestSummary} from './focus-session'
import type {StudyEvent} from './study-progress'

const number=new Intl.NumberFormat('ar')
const percent=new Intl.NumberFormat('ar',{style:'percent',maximumFractionDigits:1})
const date=new Intl.DateTimeFormat('ar',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'})
const signed=new Intl.NumberFormat('ar',{signDisplay:'always',maximumFractionDigits:1})
const n=(value:number)=>number.format(value)
const accuracy=(value:number|null)=>value===null?'—':percent.format(value)
const chapterName=(chapter:string)=>{
  const [level,index]=chapter.split(':')
  return level+' — الفصل '+n(Number(index))
}
const comparison=(value:number|null)=>value===null?'البيانات غير كافية':signed.format(value*100)+' نقطة مئوية'

export function AnswerAnalytics({events, history, legacy, library}: {
  events: StudyEvent[]; history: TestSummary[]; legacy: FrozenSession[]; library: LearningLibrary
}) {
  const index=useMemo(()=>analyticsQuestionIndex(library),[library])
  const result=useMemo(()=>analyzeAnswers(events,history,legacy,library.chapters,index),[events,history,legacy,library,index])
  const [selected,setSelected]=useState<number|null>(null)
  const [limit,setLimit]=useState(10)
  const period=result.chart[selected??-1]
  const compared=result.chapters.filter(c=>c.attempts>=8&&c.distinct>=4)
  const ranked=[...compared].sort((a,b)=>b.accuracy!-a.accuracy!)
  const best=ranked[0], weakest=ranked.at(-1)
  const repeated=result.mistakes.find(m=>m.misses>=2&&m.chapter)
  const unvisited=result.chapters.filter(c=>!c.attempts&&!c.active)
  const practice=result.chapters.filter(c=>c.active>0).sort((a,b)=>b.active-a.active)[0]
  const highestErrors=result.skills.find(s=>s.wrong>0)
  const comparableSkills=result.skills.filter(s=>s.attempts>=8&&s.distinct>=4).sort((a,b)=>b.accuracy!-a.accuracy!)
  const bestSkill=comparableSkills[0], lowestSkill=comparableSkills.at(-1)
  const trend=(change:number|null)=>change===null?'البيانات غير كافية':comparison(change)+' بين نصفي السجل المؤرّخ'
  const metrics=[
    ['اختبارات مكتملة',n(result.completed)],
    ['محاولات الإجابة',n(result.attempts)],
    ['أسئلة مختلفة',n(result.distinct)],
    ['إجابات صحيحة',n(result.correct)],
    ['إجابات خاطئة',n(result.wrong)],
    ['الدقة الإجمالية',accuracy(result.accuracy)],
    ['أخطاء نشطة',n(result.active)],
    ['أخطاء متقنة',n(result.mastered)],
  ]
  return <div className="answer-analytics">
    {!result.completed&&<p className="analytics-notice">لم تُكمل أي اختبار بعد. تظهر الإجابات المحفوظة هنا حتى إذا بقي الاختبار قيد الحل.</p>}
    <dl className="answer-metrics">{metrics.map(([label,value])=><div className="panel" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {result.undated>0&&<p className="analytics-notice">يشمل الإجمالي {n(result.undated)} إجابة قديمة استُعيدت من جلسات محفوظة بلا تاريخ لكل إجابة. تظهر في الإجماليات وتوزيع المهارات، ويضم الرسم الإجابات المؤرخة فقط. {result.unassigned>0&&<>تعذّر إسناد {n(result.unassigned)} إجابة منها إلى فصل بعينه.</>}</p>}
    {result.stoppedEarly>0&&<p className="quiet-note">عدد الجلسات المنتهية مبكرًا {n(result.stoppedEarly)}. إجاباتها تدخل في الإجمالي.</p>}
    <section className="panel analytics-panel" aria-labelledby="analytics-time">
      <h2 id="analytics-time">الدقة عبر كامل السجل</h2>
      {!result.chart.length?<p>ستظهر الفترات عندما تُحفظ إجابات مؤرخة.</p>:<>
        <p>{date.format(result.chart[0].start)} – {date.format(result.chart.at(-1)!.end)}</p>
        <div className="analytics-chart" role="group" aria-label="الدقة وعدد الإجابات لكل فترة">
          {result.chart.map((bin,i)=>{
            const count=bin.correct+bin.wrong
            const label=date.format(bin.start)+(bin.start===bin.end?'':' – '+date.format(bin.end))
            const text=count?accuracy(bin.correct/count)+' · '+n(count)+' محاولة':'بلا إجابات'
            return <button type="button" title={label+' · '+text} aria-label={label+' · '+text} aria-pressed={selected===i} key={bin.start} onClick={()=>setSelected(i)}>
              <span className="accuracy-track"><span style={{height: count? (bin.correct/count*100)+'%':'0%'}}/></span>
              <small>{n(count)}</small>
            </button>
          })}
        </div>
        <p aria-live="polite">{period?date.format(period.start)+' · '+n(period.correct)+' صحيحة، '+n(period.wrong)+' خاطئة': 'اختر عمودًا لقراءة أعداد الإجابات في فترته.'}</p>
        <p><strong>تغيّر الدقة</strong> · {trend(result.change)}</p>
      </>}
    </section>
    <section className="panel analytics-panel">
      <h2>ماذا تراجع بعد ذلك؟</h2>
      {result.attempts===0 ? <p>ابدأ اختبارًا لتتعرّف على الفصول والمهارات التي تستحق المراجعة.</p> : <ul>
        {practice&&<li>في {chapterName(practice.id)} لديك {n(practice.active)} من الأخطاء النشطة. <a href="#/mistakes">ابدأ المراجعة</a></li>}
        {repeated&&<li>تكرر الخطأ في سؤال واحد {n(repeated.misses)} مرات في {chapterName(repeated.chapter!)}.</li>}
        {result.nearMastery>0&&<li>{n(result.nearMastery)} من الأخطاء تحتاج إلى إجابة صحيحة واحدة متتالية للإتقان.</li>}
        {highestErrors&&<li>سجّلت مهارة «{highestErrors.label}» أكبر عدد من الأخطاء، {n(highestErrors.wrong)} من {n(highestErrors.attempts)} محاولة.</li>}
        {bestSkill&&lowestSkill&&bestSkill!==lowestSkill&&bestSkill.accuracy!==lowestSkill.accuracy&&<li>دقتك في «{lowestSkill.label}» {accuracy(lowestSkill.accuracy)}، وفي «{bestSkill.label}» {accuracy(bestSkill.accuracy)}. ابدأ بالمهارة الأقل دقة.</li>}
        {unvisited.length>0&&<li>جرّب {chapterName(unvisited[0].id)}. لا توجد فيه إجابات محفوظة حتى الآن.</li>}
        {best&&weakest&&best.id!==weakest.id&&best.accuracy!==weakest.accuracy
          ? <li>أعلى دقة بين الفصول التي لها سجل كافٍ في {chapterName(best.id)} بنسبة {accuracy(best.accuracy)}، وأقلها في {chapterName(weakest.id)} بنسبة {accuracy(weakest.accuracy)}.</li>
          : <li>لا توجد بيانات كافية للتمييز بين الفصول حسب الدقة.</li>}
      </ul>}
    </section>
    <section className="panel analytics-panel">
      <h2>الأداء حسب الفصل</h2>
      {!result.chapters.length&&<p>استورد ملف المحتوى لعرض أسماء الفصول ومقارنتها.</p>}
      <div className="analytics-rows">
        {result.chapters.map(row=><article key={row.id} className="analytics-row">
          <h3><bdi dir="ltr">{row.level}</bdi> — الفصل {n(row.number)} {row.title&&<bdi dir="ltr" lang="de">{row.title}</bdi>}</h3>
          {row.attempts?<><p>{n(row.distinct)} سؤالًا مختلفًا · {n(row.attempts)} محاولة · {n(row.correct)} صحيحة · {n(row.wrong)} خاطئة</p>
          <p>الدقة {accuracy(row.accuracy)} · {n(row.active)} أخطاء نشطة · {n(row.repeated)} أخطاء متكررة · {row.active?'يحتاج مراجعة الأخطاء':'لا أخطاء نشطة مسجلة'}</p>
          <p className="quiet-note">التغيّر · {trend(row.change)}</p></>:<p>{row.active?n(row.active)+' أخطاء للمراجعة. لا توجد إجابات مصححة محفوظة.':'لا توجد إجابات محفوظة في هذا الفصل.'}</p>}
        </article>)}
      </div>
    </section>
    <section className="panel analytics-panel">
      <h2>الأداء حسب نوع السؤال</h2>
      {!result.skills.length&&<p>ستظهر أنواع الأسئلة بعد تسجيل الإجابات.</p>}
      <div className="analytics-rows">{result.skills.map(row=><article key={row.id} className="analytics-row">
        <h3>{row.label}</h3><p>{n(row.attempts)} محاولة · {n(row.correct)} صحيحة · {n(row.wrong)} خاطئة · الدقة {accuracy(row.accuracy)}</p>
        <p>{n(row.active)} أخطاء نشطة · {trend(row.change)}</p>
      </article>)}</div>
    </section>
    <section className="panel analytics-panel">
      <h2>سجل الأخطاء والإتقان</h2>
      <p>{n(result.active)} نشطة · {n(result.mastered)} متقنة · {n(result.repeated)} تكرر الخطأ فيها</p>
      {!result.mistakes.length&&<p>ستظهر هنا الأسئلة بعد تسجيل الأخطاء.</p>}
      <ol className="analytics-mistakes">{result.mistakes.slice(0,limit).map(m=><li key={m.id}>
        <bdi lang={m.info?.language??'de'} dir={m.info?.language==='ar'?'rtl':'ltr'}>{m.info?.prompt??'سؤال من السجل المحفوظ'}</bdi>
        <p>{m.chapter?chapterName(m.chapter)+' · ':''}{skillLabel(m.skill??'')} · {n(m.misses)} إجابات خاطئة · {m.active?'الإجابات الصحيحة المتتالية '+n(m.streak)+' من ٢':'متقن'}</p>
      </li>)}</ol>
      {result.mistakes.length>limit&&<button className="button secondary" onClick={()=>setLimit(n=>n+10)}>تحميل المزيد</button>}
      {result.active>0&&<p><a href="#/mistakes">افتح مراجعة الأخطاء</a></p>}
    </section>
  </div>
}
