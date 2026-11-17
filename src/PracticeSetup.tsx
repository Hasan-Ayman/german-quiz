import { useState, type Dispatch, type SetStateAction } from 'react'
import { Icon } from './icons'
import { activities, levelMatches, practiceLevels, setChapters, type Activity, type PracticeChapter, type Preferences, type Scope } from './practice'
import { flashcardModes } from './study-flashcards'
import { grammarTypes, selectableTypes } from './question-types'
import type { StudyLesson } from './study-content'

export const arabicNumber = (value: number) => new Intl.NumberFormat('ar-u-nu-arab').format(value)
export const levelName = (level: Scope) => level === 'all' ? 'A1+ & A2+' : level + '+'

export const activityIcons = {
  vocabulary: 'swap', matching: 'layers', nouns: 'article', flashcard: 'cards', verb: 'verb', cloze: 'list',
  grammar: 'book', case: 'layers', order: 'sort', error: 'check', transform: 'retry', reading: 'book', writing: 'pen',
} as const

const parts = { all: 'جميع أنواع الكلمات', noun: 'الأسماء', verb: 'الأفعال', adjective: 'الصفات', adverb: 'الظروف' }

export function PracticeSetup({ prefs, update, chapters, selected, kinds, counts, entries, available, start,
  missingVocabulary, missingStudy, lessons, completeChapters }: {
  prefs: Preferences; update: Dispatch<SetStateAction<Preferences>>; chapters: PracticeChapter[]
  selected: readonly string[]; kinds: ReadonlySet<Activity>; counts: ReadonlyMap<Activity, number>
  entries: number; available: number; start: () => void; missingVocabulary: boolean; missingStudy: boolean
  lessons: StudyLesson[]; completeChapters: PracticeChapter[]
}) {
  const [showExercises, setShowExercises] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 740px)').matches)
  const actual = prefs.count === 'all' ? available : Math.min(prefs.count, available)
  const restricted = prefs.count !== 'all' && actual < prefs.count && actual > 0
  const visible = chapters.filter(chapter => levelMatches(prefs.scope, chapter.level))
  const selectedCount = visible.filter(chapter => selected.includes(chapter.id)).length
  const visibleKinds = Object.keys(activities).filter((key): key is Activity => counts.has(key as Activity))
  const hiddenSelected = prefs.activities?.filter(kind => kind !== 'writing' && !counts.has(kind)) ?? []
  const title = chapters.length ? 'ماذا تريد أن تتدرّب عليه؟' : 'ابدأ رحلتك مع الألمانية'
  const updateField = <K extends keyof Preferences>(key: K, value: Preferences[K]) =>
    update(before => ({ ...before, [key]: value }))

  function changeChapter(chapter: PracticeChapter, checked: boolean) {
    const values = visible.filter(item => item.level === chapter.level && item.id !== chapter.id &&
      selected.includes(item.id)).map(item => item.id)
    update(before => setChapters({ ...before, topic: '' }, checked ? [...values, chapter.id] : values, chapter.level))
  }

  return <>
    <div className="practice-heading">
      <p className="section-label"><Icon name="layers" size={17} /> خطة التدريب</p>
      <h1 tabIndex={-1}>{title}</h1>
      {chapters.length > 0 && <p>اختر الفصول والتمارين التي تناسب دراستك اليوم.</p>}
    </div>
    {missingVocabulary && missingStudy ? <section className="panel practice-empty">
      <span className="practice-symbol"><Icon name="book" size={25} /></span>
      <h2>أضف محتوى التعلّم الخاص بك</h2>
      <p>استورد ملف المحتوى التعليمي لبدء التدريب على هذا الجهاز.</p>
      <a href="#/settings" className="button primary">استيراد المحتوى</a>
    </section> : <div className="practice-grid">
      <div className="practice-form panel">
        <fieldset>
          <legend>المستوى</legend>
          <div className="level-options">
            {(['A1', 'A2', 'all'] as const).map(level => <label className="choice-control" key={level}>
              <input type="radio" name="practice-level" checked={prefs.scope === level} onChange={() =>
                update(before => ({ ...before, scope: level, topic: '' }))} />
              <bdi dir="ltr">{levelName(level)}</bdi>
            </label>)}
          </div>
        </fieldset>
        <fieldset className="chapter-field">
          <legend>الفصول</legend>
          <details className="chapter-picker">
            <summary><span><Icon name="book" size={18} /> {selectedCount === visible.length && visible.length ? 'كل فصول النطاق' :
              selectedCount ? 'الفصول المختارة' : 'اختر الفصول'}</span>
              <span className="picker-count">{arabicNumber(selectedCount)} / {arabicNumber(visible.length)}</span>
            </summary>
            <div className="chapter-body">
              <div className="chapter-tools">
                <button type="button" className="text-button" disabled={!visible.length}
                  onClick={() => update(before => setChapters({ ...before, topic: '' }, visible.map(item => item.id)))}>تحديد الكل</button>
                <button type="button" className="text-button" disabled={!selectedCount}
                  onClick={() => update(before => setChapters({ ...before, topic: '' }, []))}>مسح التحديد</button>
              </div>
              {practiceLevels.map(level => {
                const group = visible.filter(chapter => chapter.level === level)
                return group.length > 0 && <div className="chapter-group" key={level} role="group" aria-label={levelName(level)}>
                  <bdi dir="ltr" className="chapter-group-level">{levelName(level)}</bdi>
                  <div className="chapter-grid">{group.map(chapter => <label className="chapter-choice" key={chapter.id}>
                    <input type="checkbox" checked={selected.includes(chapter.id)} aria-label={'الفصل ' + chapter.id}
                      onChange={event => changeChapter(chapter, event.currentTarget.checked)} />
                    <span><span>الفصل {arabicNumber(chapter.number)}</span>
                      {chapter.title && <small dir="ltr" lang="de">{chapter.title}</small>}</span>
                  </label>)}</div>
                </div>
              })}
            </div>
          </details>
          {!visible.length && <p className="setup-helper">لا توجد فصول مستوردة لهذا المستوى.</p>}
        </fieldset>
        <fieldset>
          <legend>التمارين</legend>
          {visibleKinds.length ? <>
            <label className="mix-toggle">
              <input type="checkbox" checked={prefs.activities === null}
                onChange={event => updateField('activities', event.currentTarget.checked ? null : [])} />
              <Icon name="shuffle" size={18} /> تدريب مختلط
            </label>
            <details className="activity-picker" open={showExercises} onToggle={event => setShowExercises(event.currentTarget.open)}>
              <summary>تخصيص أنواع التمارين</summary>
              <div className="activity-grid">
              {visibleKinds.map(kind => <label className="activity-choice" key={kind}>
                <input type="checkbox" checked={kinds.has(kind)} onChange={event => {
                  const checked = event.currentTarget.checked
                  update(before => {
                    const current = before.activities ?? visibleKinds
                    return { ...before, activities: checked ? [...new Set([...current, kind])] : current.filter(item => item !== kind) }
                  })
                }} />
                <span className="activity-icon"><Icon name={activityIcons[kind]} size={18} /></span>
                <span>{activities[kind]}</span>
              </label>)}
              </div>
            </details>
          </> : <p className="setup-helper"> {selectedCount ? 'لا تتوفر تمارين بهذه الخيارات. جرّب تعديل الخيارات المتقدمة.' : 'اختر فصلًا واحدًا على الأقل لعرض التمارين.'}</p>}
          {hiddenSelected.length > 0 && <p className="setup-helper">غير متاح ضمن النطاق الحالي: {hiddenSelected.map(key => activities[key]).join('، ')}.</p>}
        </fieldset>
        <fieldset>
          <legend>عدد الأسئلة</legend>
          <div className="count-options">
            {([10, 20, 30, 50, 'all'] as const).map(count => <label className="choice-control" key={count}>
              <input type="radio" name="practice-count" checked={prefs.count === count} onChange={() => updateField('count', count)} />
              <span>{count === 'all' ? 'كل المتاح' : arabicNumber(count)}</span>
            </label>)}
          </div>
        </fieldset>
        <details className="advanced-options">
          <summary><Icon name="sliders" size={18} /> خيارات متقدمة</summary>
          <div className="advanced-grid">
            <label>اتجاه الترجمة<select value={prefs.direction} onChange={e => updateField('direction', e.currentTarget.value as Preferences['direction'])}>
              <option value="all">الاتجاهان</option><option value="de-ar">من الألمانية إلى العربية</option><option value="ar-de">من العربية إلى الألمانية</option>
            </select></label>
            <label>حالة المراجعة<select value={prefs.focus} onChange={e => updateField('focus', e.currentTarget.value as Preferences['focus'])}>
              <option value="all">جميع الأنشطة</option><option value="new">أنشطة جديدة</option><option value="missed">الأخطاء السابقة</option><option value="due">المراجعات المستحقة</option>
            </select></label>
            <label>نوع الكلمة<select value={prefs.part} onChange={e => updateField('part', e.currentTarget.value as Preferences['part'])}>
              {Object.entries(parts).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select></label>
            <label>درجة التطبيق<select value={prefs.difficulty} onChange={e => updateField('difficulty', e.currentTarget.value as Preferences['difficulty'])}>
              <option value="all">جميع الدرجات</option><option value="direct">تدريب مباشر</option><option value="applied">تطبيق في جملة أو نص</option>
            </select></label>
            {!missingVocabulary && <label>وجه البطاقة<select value={prefs.cards} onChange={e => updateField('cards', e.currentTarget.value as Preferences['cards'])}>
              {Object.entries(flashcardModes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select></label>}
            {lessons.length > 0 && <label>موضوع القواعد<select value={prefs.topic} onChange={e => updateField('topic', e.currentTarget.value)}>
              <option value="">جميع الموضوعات</option>{lessons.map(lesson => <option key={lesson.topic} value={lesson.topic}>{lesson.chapter} · {lesson.title}</option>)}
            </select></label>}
            {!missingVocabulary && <label>تفاصيل تدريب المفردات<select value={prefs.variants === undefined ? '' : prefs.variants.length === 1 ? prefs.variants[0] : 'saved'}
              onChange={e => updateField('variants', e.currentTarget.value ? [e.currentTarget.value] : undefined)}>
              <option value="">جميع الأسئلة المؤهلة</option>
              {prefs.variants && prefs.variants.length !== 1 && <option value="saved" disabled>التحديد المحفوظ</option>}
              {selectableTypes.map(key => {
                const [part, direction] = key.split(':')
                const label = key === 'article' ? 'أداة التعريف' : direction ? parts[part as keyof typeof parts] +
                   ' · ' + (direction === 'de-ar' ? 'ألماني إلى عربي' : 'عربي إلى ألماني') : grammarTypes[key as keyof typeof grammarTypes][1]
                return <option key={key} value={key}>{label}</option>
              })}
            </select></label>}
            {completeChapters.length > 0 && <button className="button secondary" type="button"
              onClick={() => update(before => setChapters({ ...before, topic: '' }, completeChapters.map(item => item.id)))}>
              اختيار الفصول المكتملة</button>}
          </div>
          <button className="text-button" type="button" onClick={() => update(before => ({ ...before,
            direction: 'all', focus: 'all', difficulty: 'all', part: 'all', topic: '', cards: 'de-ar', variants: undefined }))}>
            إعادة ضبط الخيارات المتقدمة</button>
        </details>
      </div>
      <aside className="start-card panel" aria-label="ملخص التدريب">
        <div className="start-card-main">
          <span className="practice-symbol"><Icon name="verb" size={22} /></span>
          <h2>ملخص التدريب</h2>
          <dl className="plan-details">
            <div><dt>المستوى</dt><dd><bdi dir="ltr">{levelName(prefs.scope)}</bdi></dd></div>
            <div><dt>الفصول</dt><dd>{arabicNumber(selectedCount)}</dd></div>
            <div><dt>أنواع التمارين</dt><dd>{arabicNumber(kinds.size)}</dd></div>
            <div><dt>الأسئلة المتاحة</dt><dd data-testid="eligible-count">{arabicNumber(available)}</dd></div>
          </dl>
          {kinds.size > 0 && <p className="plan-types">{prefs.activities === null ? 'جميع التمارين المتاحة' : [...kinds].map(key => activities[key]).join('، ')}</p>}
        </div>
        <div className="start-action">
          <p aria-live="polite">{restricted ? 'سنبدأ بـ ' + arabicNumber(actual) + ' سؤالًا، وهو كل المتاح في هذا النطاق.' :
            actual ? arabicNumber(actual) + ' في الجلسة · ' + arabicNumber(available) + ' سؤالًا متاحًا' : 'اختر فصولًا وتمارين متاحة للبدء.'}</p>
          {actual > 0 && actual < Math.max(selectedCount, kinds.size) && <p className="setup-helper">لا يكفي العدد لتغطية جميع الفصول أو الأنواع في جلسة واحدة.</p>}
          <button className="button primary" type="button" onClick={start} disabled={!actual}>ابدأ التدريب <Icon name="left" size={18} /></button>
        </div>
      </aside>
    </div>}
    {chapters.length > 0 && <div className="setup-helper practice-data-note">
      {missingVocabulary || missingStudy ? <a href="#/settings">استورد ملف المحتوى لإضافة الدروس والمفردات المتبقية</a> :
        <span><Icon name="check" size={16} /> المفردات ومحتوى الدراسة جاهزان على هذا الجهاز · {arabicNumber(entries)} مفردة</span>}
    </div>}
  </>
}
