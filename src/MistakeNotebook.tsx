import { useMemo, useState } from 'react'
import { activities, type Candidate, type PracticeChapter } from './practice'
import { activityOf, incorrect, masteryLabels, reviewOrder, type Evidence } from './learning-model'
import { categories, initialScope, inLearningScope, ScopeFields } from './LearningAnalytics'
import { arabicNumber as number } from './PracticeSetup'
import { day } from './study-progress'
import { Icon } from './icons'

const filters = {
  active: 'النشطة', due: 'المستحقّة', repeated: 'المتكررة', recent: 'الأحدث', improving: 'في تحسّن', resolved: 'المحلولة', all: 'كل الأخطاء',
} as const
type Filter = keyof typeof filters
const fullDate = new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' })
const showDate = (value?: number) => value ? fullDate.format(value) : '—'

export function visibleMistakes(ordered: Evidence[], status: Filter, now: number) {
  if (status === 'all') return ordered
  if (status === 'resolved') return ordered.filter(item => item.resolved)
  if (status === 'recent') return ordered.filter(item => item.firstMistake && now - item.firstMistake.time <= 7 * day)
    .sort((a, b) => b.firstMistake!.time - a.firstMistake!.time)
  return ordered.filter(item => !item.resolved && (status === 'active' ||
    status === 'due' && item.due <= now || status === 'repeated' && item.errors > 1 ||
    status === 'improving' && (item.stage === 'improving' || item.stage === 'strong')))
}

export function MistakeNotebook({ evidence, candidates, chapters, topics, now, onReview }: {
  evidence: Map<string, Evidence>; candidates: Map<string, Candidate>; chapters: PracticeChapter[]
  topics: Map<string, string>; now: number; onReview: (ids: string[]) => void
}) {
  const filtersFromLink = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
  const linkItem = filtersFromLink.get('item')
  const [selected, select] = useState(linkItem ?? '')
  const [filter, setFilter] = useState<Filter>(linkItem ? 'all' : 'active')
  const [scope, setScope] = useState(() => ({ level: filtersFromLink.get('level') ?? '',
    chapter: filtersFromLink.get('chapter') ?? '', skill: filtersFromLink.get('skill') ?? '' }))
  const [topic, setTopic] = useState(() => filtersFromLink.get('topic') ?? '')
  const [part, setPart] = useState(() => filtersFromLink.get('part') ?? '')
  const [query, search] = useState('')
  const [minimum, setMinimum] = useState(1)
  const [limit, setLimit] = useState(24)
  const mistakes = useMemo(() => reviewOrder([...evidence.values()].filter(item => item.errors > 0), now), [evidence, now])
  const titleFor = (item: Evidence) => topics.get(item.last.topic) || chapters.find(ch => ch.id === item.last.chapter)?.title || activities[activityOf(item.last)]
  const current = evidence.get(selected)
  const question = useMemo(() => candidates.get(selected)?.make(), [candidates, selected])
  const scoped = visibleMistakes(mistakes, filter, now).filter(item => inLearningScope(item.last, scope) &&
    (!topic || item.last.topic === topic) && (!part || (item.last.part ?? candidates.get(item.id)?.part) === part) && item.errors >= minimum)
  const needle = query.trim().normalize('NFC').toLocaleLowerCase()
  const shown = scoped.filter(item => {
    if (!needle) return true
    const candidate = candidates.get(item.id)
    return [item.id, titleFor(item), item.lastMistake?.answer, candidate?.searchText]
      .some(value => value?.normalize('NFC').toLocaleLowerCase().includes(needle))
  })
  const active = mistakes.filter(item => !item.resolved)
  const reviewIds = shown.filter(item => !item.resolved && candidates.has(item.id)).map(item => item.id)
  const totalDue = active.filter(item => item.due <= now).length
  const hotspots = (by: (item: Evidence) => string) => {
    const counts = new Map<string, number>()
    for (const item of active) {
      const key = by(item)
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 4)
  }
  function reviewAll() {
    if (reviewIds.length) onReview(reviewIds)
    else if (!shown.length && filter === 'active') onReview(active.filter(item => candidates.has(item.id)).map(item => item.id))
  }
  return <div className="learning-page">
    <header className="learning-intro"><div>
      <p className="section-label"><span className="brand-line" /> المراجعة الذكية</p><h1 tabIndex={-1}>دفتر الأخطاء</h1>
      <p>تتبع الأخطاء وراجعها حتى يثبت استرجاع الإجابة عبر فترات متباعدة.</p></div>
      <button className="button primary" type="button" disabled={!reviewIds.length} onClick={reviewAll}><Icon name="retry" size={18} /> مراجعة أخطائي</button>
    </header>
    <div className="notebook-summary">
      <span><strong>{number(active.length)}</strong> نشطة</span>
      <span><strong>{number(totalDue)}</strong> مستحقّة</span>
      <span><strong>{number(active.filter(item => item.errors > 1).length)}</strong> متكررة</span>
      <span><strong>{number(mistakes.filter(item => item.resolved).length)}</strong> محلولة</span>
      <a href="#/progress">عرض التحسّن مع الوقت <Icon name="left" size={16} /></a>
    </div>
    <div className="panel notebook-tools">
      <div className="filter-tabs" role="group" aria-label="حالة الأخطاء">
        {Object.entries(filters).map(([key, title]) => <button key={key} type="button" aria-pressed={filter === key}
          onClick={() => { setFilter(key as Filter); setLimit(24) }}>{title}</button>)}
      </div>
      <label className="notebook-search">بحث في الأخطاء<input type="search" dir="auto" value={query} placeholder="الكلمة أو السياق أو الإجابة"
        onChange={e => { search(e.target.value); setLimit(24) }} /></label>
      <details><summary>تصفية الأخطاء</summary>
        <div className="learning-filters"><ScopeFields scope={scope} update={value => { setScope(value); setTopic(''); setLimit(24) }} chapters={chapters} />
          <label>موضوع القواعد<select value={topic} onChange={e => setTopic(e.target.value)}>
            <option value="">كل الموضوعات</option>{[...new Set(mistakes.filter(item => inLearningScope(item.last, scope))
              .map(item => item.last.topic).filter(Boolean))].map(id => <option key={id} value={id}>{topics.get(id) ?? id}</option>)}</select></label>
          <label>فئة المفردة<select value={part} onChange={e => setPart(e.target.value)}><option value="">كل الفئات</option>
            {Object.entries(categories).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
          <label>التكرار<select value={minimum} onChange={e => setMinimum(Number(e.target.value))}>
            <option value="1">أي عدد</option><option value="2">مرتان أو أكثر</option><option value="3">ثلاث مرات أو أكثر</option></select></label>
        </div></details>
    </div>
    <div className="notebook-layout">
      <section className="panel notebook-list">
        <h2>السجل <small>{number(shown.length)}</small></h2>
        {shown.length ? <ul>{shown.slice(0, limit).map(item => <li key={item.id}>
          <button type="button" aria-pressed={selected === item.id} onClick={() => select(item.id)}>
            <span><strong dir="auto">{titleFor(item)}</strong><small><bdi dir="ltr">{item.last.chapter}</bdi> · {activities[activityOf(item.last)]}</small></span>
            <span className="mastery-tag" data-stage={item.stage}>{masteryLabels[item.stage]}</span>
          </button></li>)}</ul> : <p className="metric-empty">{mistakes.length ? 'لا توجد أخطاء توافق عوامل التصفية.' : 'ستظهر الأخطاء هنا بعد تسجيل إجابة غير صحيحة.'}</p>}
        {shown.length > limit && <button type="button" className="text-button" onClick={() => setLimit(value => value + 24)}>عرض المزيد</button>}
      </section>
      <section className="panel notebook-detail" aria-label="تفاصيل الخطأ">
        {current?.lastMistake ? <>
          <div className="panel-heading"><div><h2>تفاصيل الخطأ</h2><p><bdi dir="ltr">{current.last.chapter}</bdi> · {activities[activityOf(current.last)]}</p></div>
            <span className="mastery-tag" data-stage={current.stage}>{masteryLabels[current.stage]}</span></div>
          <dl className="mistake-facts">
            <div><dt>السؤال</dt><dd dir="auto">{question?.prompt || question?.instruction || 'السؤال الأصلي غير متاح في المحتوى الحالي.'}</dd></div>
            <div><dt>إجابتك الأخيرة</dt><dd dir="auto">{current.lastMistake.answer || 'لم تُحفظ الإجابة النصية في هذا السجل.'}</dd></div>
            <div><dt>الإجابة المعتمدة</dt><dd dir="auto">{question?.pairs?.map(pair => pair.german + ' — ' + pair.arabic).join(' · ') ?? question?.answers.join(' / ') ?? 'غير متاحة'}</dd></div>
            <div><dt>الشرح بالعربية</dt><dd>{question?.explanation || 'لا يتوفر شرح موثّق لهذا السؤال.'}</dd></div>
            {question?.examples?.[0] && <div><dt>مثال</dt><dd lang="de" dir="ltr">{question.examples[0].german}</dd></div>}
            {question && <div><dt>المرجع</dt><dd><bdi dir="ltr">{question.source.document}</bdi> · صفحة {number(question.source.page)}</dd></div>}
            <div><dt>عدد الأخطاء والمراجعات الناجحة</dt><dd>{number(current.errors)} · {number(current.reviews)}</dd></div>
            <div><dt>أول خطأ</dt><dd>{showDate(current.firstMistake?.time)}</dd></div>
            <div><dt>آخر خطأ</dt><dd>{showDate(current.lastMistake.time)}</dd></div>
            <div><dt>آخر مراجعة في موعدها</dt><dd>{showDate(current.lastReview)}</dd></div>
            <div><dt>المراجعة التالية</dt><dd>{showDate(current.due)}</dd></div>
          </dl>
          <details><summary>سجل المحاولات</summary><ul className="attempt-history">
            {[...current.history].reverse().map(event => <li key={event.id}>
              <span>{incorrect(event) ? 'تحتاج مراجعة' : 'استرجاع ناجح'}</span><time dateTime={new Date(event.time).toISOString()}>{showDate(event.time)}</time>
            </li>)}</ul></details>
          <button className="button primary" type="button" disabled={!candidates.has(current.id)}
            onClick={() => onReview([current.id])}>راجع هذا السؤال</button>
        </> : <p className="metric-empty">اختر سؤالًا من السجل لعرض إجابتك وموعد مراجعته.</p>}
      </section>
    </div>
    {active.length > 0 && <div className="learning-columns equal">
      <section className="panel learning-breakdown"><h2>الفصول الأكثر حاجة للمراجعة</h2>
        <ul>{hotspots(item => item.last.chapter).map(([key, count]) => <li key={key}>
          <button type="button" className="text-button" onClick={() => { setScope({ ...initialScope, chapter: key }); setFilter('active') }}>
            <bdi dir="ltr">{key}</bdi> · {number(count)} أخطاء</button></li>)}</ul></section>
      <section className="panel learning-breakdown"><h2>موضوعات القواعد المتكررة</h2>
        <ul>{hotspots(item => item.last.topic).map(([key, count]) => <li key={key}>
          <button type="button" className="text-button" onClick={() => { setScope(initialScope); setTopic(key); setFilter('active') }}>
            {topics.get(key) ?? key} · {number(count)} أخطاء</button></li>)}</ul></section>
    </div>}
  </div>
}
