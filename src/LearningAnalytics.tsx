import { useMemo, useState } from 'react'
import { Icon } from './icons'
import { arabicNumber as number } from './PracticeSetup'
import { activities, type Activity, type PracticeChapter } from './practice'
import { activityOf, buildEvidence, graded, incorrect, masterySummary, type Evidence } from './learning-model'
import { day, type StudyEvent } from './study-progress'

const date = new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'short' })
const percent = (value: number | null) => value === null ? 'أدلة غير كافية' : new Intl.NumberFormat('ar', { style: 'percent' }).format(value)
export const categories = { noun: 'الأسماء', verb: 'الأفعال', adjective: 'الصفات', adverb: 'الظروف' } as const
export type LearningScope = { level: string; chapter: string; skill: string }
export const initialScope: LearningScope = { level: '', chapter: '', skill: '' }

export function ScopeFields({ scope, update, chapters }: {
  scope: LearningScope; update: (value: LearningScope) => void; chapters: PracticeChapter[]
}) {
  return <>
    <label>المستوى<select value={scope.level} onChange={e => update({ ...scope, level: e.target.value, chapter: '' })}>
      <option value="">كل المستويات</option><option value="A1" dir="ltr">A1+</option><option value="A2" dir="ltr">A2+</option></select></label>
    <label>الفصل<select value={scope.chapter} onChange={e => update({ ...scope, chapter: e.target.value })}>
      <option value="">كل الفصول</option>{chapters.filter(item => !scope.level || item.level === scope.level).map(item =>
        <option key={item.id} value={item.id} dir="ltr">{item.id} · {item.title}</option>)}</select></label>
    <label>المهارة<select value={scope.skill} onChange={e => update({ ...scope, skill: e.target.value })}>
      <option value="">كل المهارات</option>{Object.entries(activities).filter(([key]) => key !== 'writing').map(([key, label]) =>
        <option key={key} value={key}>{label}</option>)}</select></label>
  </>
}

export function inLearningScope(event: StudyEvent, scope: LearningScope) {
  return (!scope.level || event.chapter.startsWith(scope.level + ':')) &&
    (!scope.chapter || event.chapter === scope.chapter) && (!scope.skill || activityOf(event) === scope.skill)
}

const chartNames = { mastery: 'الإتقان', answers: 'الإجابات', errors: 'الأخطاء المتكررة', activity: 'نشاط التعلّم', review: 'المراجعات الناجحة' } as const
type Metric = keyof typeof chartNames
const toDay = (time: number) => { const d = new Date(time); d.setHours(0, 0, 0, 0); return d.getTime() }

function chartSeries(events: StudyEvent[], span: number, now: number) {
  const dayStart = toDay(now)
  const daysPerPeriod = Math.ceil(span / 8)
  const periods = Math.ceil(span / daysPerPeriod)
  const bins = Array.from({ length: periods }, (_, index) => {
    const start = dayStart + (index * daysPerPeriod - span + 1) * day
    const end = Math.min(start + daysPerPeriod * day, dayStart + day)
    return { start, end, correct: 0, wrong: 0, repeated: 0, attempts: 0, reviews: 0, mastery: null as number | null }
  })
  const errorsSeen = new Set<string>()
  for (const event of events) {
    const index = Math.floor((event.time - bins[0].start) / (daysPerPeriod * day))
    const bin = bins[index]
    if (bin && event.time <= now) {
      bin.attempts++
      if (graded(event)) {
        if (incorrect(event)) bin.wrong++
        else bin.correct++
      }
      if (incorrect(event) && errorsSeen.has(event.questionId)) bin.repeated++
    }
    if (incorrect(event)) errorsSeen.add(event.questionId)
  }
  let reviewed = [...buildEvidence(events.filter(event => event.time < bins[0].start)).values()].reduce((sum, item) => sum + item.reviews, 0)
  for (const bin of bins) {
    const learned = [...buildEvidence(events.filter(event => event.time < bin.end && event.time <= now)).values()]
    bin.mastery = masterySummary(learned).value
    const total = learned.reduce((sum, item) => sum + item.reviews, 0)
    bin.reviews = total - reviewed
    reviewed = total
  }
  return bins
}

export function LearningChart({ events, now, compact = false }: { events: StudyEvent[]; now: number; compact?: boolean }) {
  const [metric, setMetric] = useState<Metric>('mastery')
  const [span, setSpan] = useState(30)
  const [active, setActive] = useState<number | null>(null)
  const today = toDay(now)
  const series = useMemo(() => chartSeries(events, span, today + day - 1), [events, span, today])
  const value = (point: typeof series[number]) => metric === 'mastery' ? point.mastery === null ? null : point.mastery * 100 :
    metric === 'answers' ? point.correct + point.wrong : metric === 'errors' ? point.repeated : metric === 'review' ? point.reviews : point.attempts
  const max = metric === 'mastery' ? 100 : Math.max(1, ...series.map(point => value(point) ?? 0))
  const peak = active === null ? series.at(-1)! : series[active] ?? series.at(-1)!
  const summary = (point: typeof series[number]) => metric === 'mastery' ? percent(point.mastery) :
    metric === 'answers' ? number(point.correct) + ' صحيحة · ' + number(point.wrong) + ' خاطئة' : number(value(point) ?? 0)
  const empty = !series.some(point => value(point) !== null && (metric === 'mastery' || (value(point) ?? 0) > 0))
  return <section className="panel metric-chart" aria-labelledby="trend-title">
    <div className="panel-heading"><div><h2 id="trend-title">التقدّم مع الوقت</h2><p>اختر فترة من الرسم لعرض تفاصيلها.</p></div>
      <div className="chart-tools">
        <label>المقياس<select value={metric} onChange={e => { setMetric(e.target.value as Metric); setActive(null) }}>
          {Object.entries(chartNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {!compact && <label>الفترة<select value={span} onChange={e => { setSpan(Number(e.target.value)); setActive(null) }}>
          {[7, 30, 90].map(days => <option key={days} value={days}>{number(days)} يومًا</option>)}</select></label>}
      </div>
    </div>
    {empty && <p className="metric-empty">{metric === 'mastery' ? 'يظهر منحنى الإتقان بعد نجاح استرجاع عدة أسئلة على فترات متباعدة.' : 'لا توجد سجلات لهذا المقياس في الفترة المحددة.'}</p>}
    {!empty && <div className="chart-bars" aria-label={chartNames[metric]}>
      {series.map((point, index) => {
        const y = value(point)
        const total = (y ?? 0) / max * 100
        const correct = metric === 'answers' ? point.correct / max * 100 : total
        const label = date.format(point.start)
        return <button type="button" className="chart-column" key={point.start} aria-pressed={peak === point}
          aria-label={label + ' · ' + summary(point)} onClick={() => setActive(index)}>
          <span className="chart-plot" aria-hidden="true">
            {y === null ? <i className="chart-unknown" /> :
              <><i className="chart-fill" style={{ height: correct + '%' }} />
                {total > correct && <i className="chart-wrong" style={{ height: (total - correct) + '%' }} />}</>}
          </span>
          <span>{label}</span>
        </button>
      })}
    </div>}
    {!empty && <output className="chart-reading" aria-live="polite">{date.format(peak.start)} – {date.format(peak.end - 1)} · {summary(peak)}</output>}
  </section>
}

export type Suggestion = { chapter: string; topic?: string; skill?: Activity; part?: keyof typeof categories }
type Row = { key: string; label: string; items: Evidence[]; target: Suggestion }

function clusters(items: Evidence[], by: (item: Evidence) => string | undefined,
  label: (key: string) => string, target: (key: string, item: Evidence) => Suggestion): Row[] {
  const result = new Map<string, Row>()
  for (const item of items) {
    const key = by(item)
    if (!key) continue
    if (!result.has(key)) result.set(key, { key, label: label(key), items: [], target: target(key, item) })
    result.get(key)!.items.push(item)
  }
  return [...result.values()].sort((a, b) => {
    const count = (row: Row) => row.items.filter(item => item.errors > 0 && !item.resolved).length
    return count(b) - count(a) || a.label.localeCompare(b.label)
  })
}
const reviewNeeded = (item: Evidence) => item.errors > 0 && !item.resolved

function chapterRows(items: Evidence[], chapters: PracticeChapter[]) {
  const attempted = clusters(items, item => item.last.chapter, key => chapters.find(ch => ch.id === key)?.title ?? key,
    key => ({ chapter: key }))
  const found = new Set(attempted.map(row => row.key))
  return [...attempted, ...chapters.filter(ch => !found.has(ch.id)).map(ch => ({ key: ch.id,
    label: ch.title ?? ch.id, target: { chapter: ch.id }, items: [] }))]
}

function notebookLink(target: Suggestion) {
  const query = new URLSearchParams()
  if (target.chapter) query.set(target.chapter.includes(':') ? 'chapter' : 'level', target.chapter)
  if (target.topic) query.set('topic', target.topic)
  if (target.skill) query.set('skill', target.skill)
  if (target.part) query.set('part', target.part)
  return '#/mistakes?' + query.toString()
}

function Breakdown({ title, rows, configure }: { title: string; rows: Row[]; configure: (value: Suggestion) => void }) {
  return <section className="panel learning-breakdown">
    <h2>{title}</h2>
    {rows.length ? <ul>{rows.map(row => {
      const summary = masterySummary(row.items)
      const weak = row.items.filter(reviewNeeded).length
      return <li key={row.key}><button className="text-button" type="button" onClick={() => configure(row.target)}>
        <span dir="auto">{row.label}</span><Icon name="left" size={15} /></button>
        <div className="breakdown-evidence">
          <small>{row.items.length ? percent(summary.value) + ' · ' + number(weak) + ' تحتاج مراجعة' : 'لم يبدأ التعلّم'}</small>
          {weak > 0 && <a className="related-mistakes" href={notebookLink(row.target)} aria-label={'أخطاء ' + row.label}>اعرض الأخطاء</a>}
        </div>
        {summary.value !== null && <progress aria-label={'الإتقان · ' + row.label} max={1} value={summary.value} />}
      </li>
    })}</ul> : <p className="metric-empty">لا توجد محاولات موثّقة لهذا القسم.</p>}
  </section>
}

export function LearningDashboard({ evidence, events, chapters, topics, now, ready, resumable, review, configure, goal,
  historyLoading, canReview, legacyLink }: {
  evidence: Map<string, Evidence>; events: StudyEvent[]; chapters: PracticeChapter[]; topics: Map<string, string>
  now: number; ready: boolean; resumable: boolean; review: () => void; configure: (value: Suggestion) => void
  goal: number; historyLoading: boolean; canReview: boolean; legacyLink?: string
}) {
  const items = useMemo(() => [...evidence.values()], [evidence])
  const due = items.filter(item => item.due <= now).length
  const active = useMemo(() => items.filter(reviewNeeded), [items])
  const recent = events.filter(event => event.result !== 'completed').slice(-3).reverse()
  const daily = events.filter(event => event.time >= toDay(now) && event.result !== 'completed').length
  const weak = useMemo(() => clusters(active, item => item.last.topic || item.last.chapter,
    id => topics.get(id) ?? chapters.find(ch => ch.id === id)?.title ?? id,
    (_, item) => ({ chapter: item.last.chapter, topic: item.last.topic })), [active, chapters, topics])
  const mastery = masterySummary(items)
  const vocabularyWeak = clusters(active, item => item.last.part, key => categories[key as keyof typeof categories],
    (key, item) => ({ chapter: item.last.chapter, part: key as keyof typeof categories }))
  const skills = clusters(items, item => activityOf(item.last), key => activities[key as Activity],
    (key, item) => ({ chapter: item.last.chapter, skill: key as Activity }))
  return <div className="learning-page">
    <header className="learning-intro">
      <div><p className="section-label"><span className="brand-line" /> لوحة التعلّم</p>
        <h1 tabIndex={-1}>تقدّمك في الألمانية</h1>
        <p>{items.length ? 'تابع ما أتقنته وما يحتاج إلى مراجعة.' : 'سجّل محاولاتك لتتبع تقدّمك وبناء خطة مراجعة تناسبك.'}</p></div>
      <div className="study-actions">
        {resumable && <a className="button secondary" href="#/practice">تابع آخر جلسة</a>}
        <a className="button primary" href={ready ? '#/setup' : '#/settings'}>{ready ? 'ابدأ التدريب' : 'استيراد المحتوى'} <Icon name="left" size={17} /></a>
      </div>
    </header>
    {historyLoading ? <p role="status" className="panel metric-empty">جارٍ استعادة تقدّمك…</p> : <>
      <div className="learning-kpis">
        <MetricCard label="الإتقان العام" value={percent(mastery.value)} detail={number(mastery.mastered) + ' أسئلة متقنة'} featured />
        {['A1', 'A2'].map(level => <MetricCard key={level} label={<bdi dir="ltr">{level}+</bdi>}
          value={percent(masterySummary(items.filter(item => item.last.chapter.startsWith(level + ':'))).value)} detail="من الأسئلة التي تدرّبت عليها" />)}
        <MetricCard label="مراجعات مستحقّة" value={number(due)} detail={number(active.length) + ' أخطاء نشطة'} />
        <MetricCard label="نشاط اليوم" value={number(daily)} detail="محاولات مسجّلة" />
      </div>
      <div className="learning-columns">
        <LearningChart events={events} now={now} compact />
        <section className="panel learning-actions">
          <h2>خطوتك التالية</h2>
          <button type="button" className="button secondary" disabled={!canReview} onClick={review}>راجع الأسئلة المستحقّة</button>
          <a className="button secondary" href="#/mistakes">مراجعة أخطائي</a>
          {weak[0] && <div className="recommendation"><small>موضوع يحتاج إلى المراجعة</small>
            <button type="button" className="text-button" onClick={() => configure(weak[0].target)}><span dir="auto">{weak[0].label}</span><Icon name="left" size={15} /></button></div>}
          {goal > 0 && <div className="daily-goal"><strong>هدفي اليومي</strong>
            <progress max={goal} value={Math.min(daily, goal)} aria-label="الهدف اليومي" />
            <small>{number(daily)} / {number(goal)} محاولة</small></div>}
          {legacyLink && <a className="text-button" href={legacyLink}>آخر اختبار مفردات محفوظ</a>}
          <a className="text-button" href="#/progress">استكشف التحليلات <Icon name="left" size={15} /></a>
        </section>
      </div>
      <div className="learning-columns equal">
        <Breakdown title="إتقان الفصول" rows={chapterRows(items, chapters).slice(0, 4)} configure={configure} />
        <Breakdown title="الموضوعات التي تحتاج مراجعة" rows={weak.slice(0, 4)} configure={configure} />
        <Breakdown title="إتقان المهارات" rows={skills.slice(0, 4)} configure={configure} />
        <Breakdown title="فئات المفردات التي تحتاج مراجعة" rows={vocabularyWeak.slice(0, 4)} configure={configure} />
      </div>
      {recent.length > 0 && <section className="panel learning-breakdown"><h2>آخر المحاولات</h2>
        <ul>{recent.map(event => <li key={event.id}><span>{activities[activityOf(event)]} · <bdi dir="ltr">{event.chapter}</bdi></span>
          <small>{date.format(event.time)} · {incorrect(event) ? 'تحتاج مراجعة' : 'استرجاع ناجح'}</small></li>)}</ul></section>}
    </>}
  </div>
}

function MetricCard({ label, value, detail, featured }: { label: React.ReactNode; value: string; detail: string; featured?: boolean }) {
  return <div className={'panel metric-card' + (featured ? ' featured-metric' : '')}><h2>{label}</h2><strong>{value}</strong><small>{detail}</small></div>
}

function ReviewWorkload({ items, now }: { items: Evidence[]; now: number }) {
  const [windowDays, setWindowDays] = useState(7)
  const due = items.filter(item => item.due <= now).length
  const upcoming = items.filter(item => item.due > now && item.due <= now + windowDays * day).length
  return <section className="panel learning-actions" aria-labelledby="review-workload">
    <h2 id="review-workload">عبء المراجعة</h2>
    <p>الأسئلة المسجّلة في النطاق الحالي، وفق مواعيدها المحسوبة.</p>
    <div className="filter-tabs" role="group" aria-label="أفق المراجعة">
      {[7, 30].map(days => <button key={days} type="button" aria-pressed={windowDays === days}
        onClick={() => setWindowDays(days)}>{number(days)} يومًا</button>)}
    </div>
    <dl className="workload-values" aria-live="polite">
      <div><dt>مستحقّة الآن</dt><dd>{number(due)}</dd></div>
      <div><dt>قادمة خلال {number(windowDays)} يومًا</dt><dd>{number(upcoming)}</dd></div>
    </dl>
  </section>
}

export function LearningAnalytics({ events, chapters, topics, now, configure, legacyLink }: {
  events: StudyEvent[]; chapters: PracticeChapter[]; topics: Map<string, string>; now: number
  configure: (value: Suggestion) => void; legacyLink?: string
}) {
  const [scope, updateScope] = useState(initialScope)
  const filtered = useMemo(() => events.filter(item => inLearningScope(item, scope)), [events, scope])
  const items = useMemo(() => [...buildEvidence(filtered).values()], [filtered])
  const totals = masterySummary(items)
  const scored = filtered.filter(graded)
  const active = items.filter(reviewNeeded)
  const due = items.filter(item => item.due <= now)
  const easy = (key: string, item: Evidence): Suggestion => ({ chapter: item.last.chapter, skill: key as Activity })
  return <div className="learning-page">
    <header className="learning-intro"><div><p className="section-label"><span className="brand-line" /> سجل التعلّم</p>
      <h1 tabIndex={-1}>تحليلات التقدّم</h1><p>استكشف المحاولات والإتقان والمراجعات حسب المستوى والفصل والمهارة.</p></div>
      <a className="button secondary" href="#/mistakes">دفتر الأخطاء</a></header>
    <div className="panel learning-filters"><ScopeFields scope={scope} update={updateScope} chapters={chapters} /></div>
    <div className="learning-kpis analytics-kpis">
      <MetricCard label="الإتقان" value={percent(totals.value)} detail="المتقن ÷ الأسئلة المجرّبة" />
      <MetricCard label="الدقّة" value={scored.length ? percent(scored.filter(event => event.result === 'correct').length / scored.length) : '—'} detail="الصحيحة ÷ المحاولات المصحّحة" />
      <MetricCard label="أسئلة جُرّبت" value={number(totals.touched)} detail={number(filtered.length) + ' محاولة مسجّلة'} />
      <MetricCard label="الأسئلة المستحقّة" value={number(due.length)} detail={number(active.length) + ' أخطاء نشطة'} />
    </div>
    <div className="learning-columns"><LearningChart events={filtered} now={now} /><ReviewWorkload items={items} now={now} /></div>
    <div className="learning-columns equal">
      <Breakdown title="المستويات" rows={clusters(items, item => item.last.chapter.slice(0, 2), key => key + '+', key => ({ chapter: key }))} configure={configure} />
      <Breakdown title="المهارات" rows={clusters(items, item => activityOf(item.last), key => activities[key as Activity], easy)} configure={configure} />
      <Breakdown title="الفصول" rows={chapterRows(items, chapters.filter(ch =>
        (!scope.level || ch.level === scope.level) && (!scope.chapter || ch.id === scope.chapter)))} configure={configure} />
      <Breakdown title="مواضيع القواعد التي تحتاج مراجعة" rows={clusters(active, item => item.last.topic, key => topics.get(key) ?? key,
        (key, item) => ({ chapter: item.last.chapter, topic: key }))} configure={configure} />
      <Breakdown title="فئات المفردات التي تحتاج مراجعة" rows={clusters(active, item => item.last.part, key => categories[key as keyof typeof categories],
        (key, item) => ({ chapter: item.last.chapter, part: key as keyof typeof categories }))} configure={configure} />
      <section className="panel learning-breakdown"><h2>قياس التقدّم</h2>
        <p>الإتقان يتطلب نجاحًا متكررًا في موعد المراجعة. تظهر النسبة بعد توفر أدلة لثلاثة أسئلة على الأقل.</p>
        <p>تعدّ التغطية الأسئلة التي جُرّبت. تُحسب الدقّة من المحاولات المصحّحة، دون تقييم البطاقات الذاتي.</p>
        <p>المراجعة الناجحة هي استرجاع صحيح في موعده. المراجعات المبكرة تظل في السجل.</p>
        {filtered.some(item => item.result === 'completed') && <p>{number(filtered.filter(item => item.result === 'completed').length)} نشاط كتابة مؤرشف.</p>}
        {legacyLink && <a className="text-button" href={legacyLink}>افتح اختبار المفردات السابق</a>}
      </section>
    </div>
  </div>
}
