import { useState, type ChangeEvent } from 'react'
import { downloadStudyJson, encodeProgress, readProgressFile, reviewSchedule, saveStudyProgress,
  studyStats, type StudyEvent } from './study-progress'
import type { StudyPack, StudyQuestion } from './study-content'
import { studyTypeLabels } from './study-labels'

const number = new Intl.NumberFormat('ar-u-nu-arab')
const percent = new Intl.NumberFormat('ar-u-nu-arab', { style: 'percent', maximumFractionDigits: 0 })

export function StudyProgress({ pack, additional, events, update, retry }: {
  pack: StudyPack; additional: StudyQuestion[]; events: StudyEvent[]; update: (events: StudyEvent[]) => void; retry: (items: StudyQuestion[]) => void
}) {
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const stats = studyStats(events)
  const schedule = reviewSchedule(events)
  const retryable = [...pack.questions, ...additional].filter(item => schedule.get(item.id)?.needsReview)
  const byLesson = pack.lessons.map(lesson => ({ lesson, stats: studyStats(events.filter(event => event.topic === lesson.topic)) }))
    .filter(item => item.stats.completed > 0)

  async function restore(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    setStatus('')
    setError('')
    try {
      const result = await saveStudyProgress(await readProgressFile(file))
      update(result)
      setStatus('تم دمج سجلات التقدم المحفوظة.')
    } catch {
      setError('تعذّر استعادة التقدم. تحقّق من الملف؛ ظلَّ التقدم الحالي محفوظًا.')
    }
  }

  return <section className="panel study-flow" aria-label="لوحة التقدم">
    <h2>لوحة التقدم</h2>
    <p>{number.format(stats.completed)} نشاطًا جُرّب · {number.format(stats.wrong)} خطأ أو بطاقة للمراجعة.</p>
    {stats.attempts > 0 && <p>دقة الإجابات المصحّحة: {percent.format(stats.correct / stats.attempts)}.</p>}
    <p>المراجعات المستحقّة: {number.format([...schedule.values()].filter(item => item.due <= Date.now()).length)}.</p>
    <details>
      <summary>دفتر الأخطاء وإتقان القواعد</summary>
      {byLesson.length ? <ul>{byLesson.map(({ lesson, stats }) => <li key={lesson.topic}>
        {lesson.title} · <bdi dir="ltr">{lesson.chapter}</bdi> · {number.format(stats.wrong)} أخطاء · {stats.mastered ? 'مؤشر الإتقان محقّق' : 'قيد التمرّن'}
      </li>)}</ul> : <p>ستظهر النتائج هنا بعد التدريب.</p>}
      {retryable.length > 0 && <button className="button secondary" type="button" onClick={() => retry(retryable)}>أعد تدريب الأخطاء</button>}
    </details>
    {events.length > 0 && <details>
      <summary>الأداء حسب نوع التمرين</summary>
      <ul>{(Object.keys(studyTypeLabels) as StudyQuestion['type'][]).map(type => {
        const activity = studyStats(events.filter(event => event.type === type))
        return activity.completed > 0 ? <li key={type}>{studyTypeLabels[type]} · {number.format(activity.completed)} نشاط
          {activity.attempts > 0 && ' · ' + percent.format(activity.correct / activity.attempts)}</li> : null
      })}</ul>
    </details>}
    <details>
      <summary>النسخ الاحتياطي والاستعادة</summary>
      <div className="study-flow">
        <button className="button secondary" type="button" onClick={() =>
          downloadStudyJson('german-quiz-study-progress-private.json', encodeProgress(events))}>تنزيل التقدم</button>
        <button className="button secondary" type="button" onClick={() =>
          downloadStudyJson('german-quiz-study-private.json', JSON.stringify(pack))}>تنزيل حزمة الدراسة</button>
        <label htmlFor="study-progress-file">استعادة أو دمج التقدم</label>
        <input id="study-progress-file" type="file" accept=".json,application/json" onChange={restore} />
        {status && <p role="status">{status}</p>}
        {error && <p role="alert">{error}</p>}
      </div>
    </details>
  </section>
}
