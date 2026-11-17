import { useEffect, useState, type ChangeEvent } from 'react'
import { readStudyFile, studyTypes, validateStudyPack, type StudyChapter, type StudyPack, type StudyQuestion, type StudyType } from './study-content'
import { studyPool, studyRound, type StudyFilter } from './study-engine'
import { loadStudyPack, saveStudyPack } from './study-storage'

import type { PersonalDataset } from './personal-data'
import { flashcardModes, vocabularyFlashcards, type FlashcardMode } from './study-flashcards'
import { StudyExercise } from './StudyExercise'

const interactive = new Set<StudyType>(['flashcard', 'cloze', 'verb', 'grammar', 'case', 'order', 'error', 'transform', 'reading', 'writing'])

const names: Record<StudyType, string> = {
  cloze: 'إكمال الجمل', flashcard: 'بطاقات المفردات', verb: 'تصريف الأفعال', grammar: 'تحديات القواعد',
  reading: 'فهم المقروء', order: 'ترتيب الجملة', case: 'الحالات الإعرابية', error: 'تصحيح الأخطاء',
  transform: 'تحويل الجملة', writing: 'التعبير الكتابي',
}
const number = new Intl.NumberFormat('ar-u-nu-arab')

function ChapterOverview({ chapter, pack }: { chapter: StudyChapter; pack: StudyPack }) {
  return <section className="panel study-flow" aria-label="نظرة عامة على الفصل">
    <h2 lang="de" dir="ltr">{chapter.title}</h2>
    <p className="study-source"><bdi dir="ltr">{chapter.id}</bdi> · صفحات PDF {number.format(chapter.startPage)}–{number.format(chapter.endPage)}</p>
    <details open>
      <summary>أهداف التعلّم</summary>
      <ul lang="de" dir="ltr">{chapter.objectives.map((text, i) => <li key={i}>{text}</li>)}</ul>
    </details>
    <details>
      <summary>موضوعات الفصل وقواعده</summary>
      <ul lang="de" dir="ltr">{[...chapter.themes, ...chapter.grammar].map((text, i) => <li key={i}>{text}</li>)}</ul>
    </details>
    <details>
      <summary>النطق والاستماع</summary>
      <ul lang="de" dir="ltr">{chapter.pronunciation.map((item, i) => <li key={i}>{item}</li>)}</ul>
      <p>موضوعات النطق موثّقة في صفحة PDF {number.format(chapter.overviewPage)}.</p>
      {chapter.pageCandidates.listening?.length > 0 && <p>صفحات مرشّحة لأنشطة الاستماع: {chapter.pageCandidates.listening.map(page => number.format(page)).join('، ')}.</p>}
      <p>تسجيلات الكتاب غير مرفقة. الاستماع والإملاء باستخدام التسجيلات الأصلية غير متاحين.</p>
    </details>
    {pack.lessons.filter(lesson => lesson.chapter === chapter.id).map(lesson => <details key={lesson.topic}>
      <summary>{lesson.title}</summary>
      <p lang="ar" dir="rtl">{lesson.explanation}</p>
      <p lang="de" dir="ltr">{lesson.german}</p>
      <p lang="ar" dir="rtl">{lesson.arabic}</p>
      <small>مرجع الدرس: صفحة PDF {number.format(lesson.source.page)}</small>
    </details>)}
  </section>
}

export function StudyPage({ vocabulary }: { vocabulary?: PersonalDataset }) {
  const [pack, setPack] = useState<StudyPack | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState<'chapter' | 'free'>('chapter')
  const [level, setLevel] = useState<StudyFilter['level']>('all')
  const [selected, setSelected] = useState<string[]>([])
  const [chapterId, setChapterId] = useState('A1:1')
  const [type, setType] = useState<StudyFilter['type']>('all')
  const [topic, setTopic] = useState('')
  const [count, setCount] = useState(10)
  const [flashcardMode, setFlashcardMode] = useState<FlashcardMode>('de-ar')
  const [automatic, setAutomatic] = useState(false)
  const [session, setSession] = useState<StudyQuestion[]>([])

  useEffect(() => {
    let active = true
    void loadStudyPack().then(value => {
      if (active && value) setPack(validateStudyPack(value))
    }).catch(() => {
      if (active) setError('تعذّر فتح حزمة الدراسة المحفوظة.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [])

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    setError('')
    setLoading(true)
    try {
      const data = await readStudyFile(file)
      await saveStudyPack(data)
      setPack(data)
      setLevel('all')
      setSelected([])
      setTopic('')
    } catch {
      setError('تعذّر استيراد الحزمة. اختر ملف حزمة الدراسة الخاص، وتحقق من مساحة التخزين.')
    } finally {
      setLoading(false)
    }
  }

  const chapter = pack?.chapters.find(chapter => chapter.id === chapterId)
  const scope = view === 'chapter' ? chapter ? [chapter.id] : [] : selected
  const filter = { level: view === 'chapter' ? 'all' as const : level, chapters: scope, type, topic }
  const fromPack = pack ? studyPool(pack, filter) : []
  const pool = type === 'flashcard' && vocabulary && !topic
    ? vocabularyFlashcards(vocabulary, filter, flashcardMode, automatic) : fromPack
  const playable = pool.filter(item => interactive.has(item.type))
  const shownChapters = pack?.chapters.filter(chapter => level === 'all' || chapter.id.startsWith(level + ':')) ?? []

  return <main className="site-container main-content study-flow">
    <div className="study-title"><h1>مركز الدراسة</h1><a href="#/" className="button secondary">اختبار المفردات</a></div>
    <section className="panel study-flow">
      <label htmlFor="study-import">حزمة الدراسة الخاصة</label>
      <input id="study-import" type="file" accept=".json,application/json" onChange={importFile} disabled={loading} />
      {loading && <p role="status">جارٍ تجهيز حزمة الدراسة…</p>}
      {error && <p role="alert">{error}</p>}
      {pack ? <p>{number.format(pack.chapters.length)} فصلًا محمّلًا على هذا الجهاز.</p>
        : !loading && <p>استورد ملف حزمة الدراسة لعرض الفصول والأنشطة. ملف المفردات الحالي مستقل.</p>}
    </section>

    {session.length > 0 ? <StudyExercise items={session} close={() => setSession([])} /> : pack && <>
      <nav className="study-actions" aria-label="طريقة الدراسة">
        <button type="button" className="button secondary" aria-pressed={view === 'chapter'} onClick={() => { setView('chapter'); setTopic('') }}>الدراسة حسب الفصل</button>
        <button type="button" className="button secondary" aria-pressed={view === 'free'} onClick={() => { setView('free'); setTopic('') }}>التدريب الحر</button>
      </nav>
      <div className="study-columns">
        <section className="panel study-flow" aria-label="إعداد التدريب">
          {view === 'chapter' ? <label>الفصل
            <select aria-label="الفصل" value={chapterId} onChange={event => { setChapterId(event.target.value); setTopic('') }}>
              {pack.chapters.map(item => <option key={item.id} value={item.id}>{item.id} · {item.title}</option>)}
            </select>
          </label> : <>
            <label>المستوى
              <select aria-label="المستوى" value={level} onChange={event => { setLevel(event.target.value as StudyFilter['level']); setSelected([]); setTopic('') }}>
                <option value="all">A1 + A2</option><option value="A1">A1</option><option value="A2">A2</option>
              </select>
            </label>
            <details><summary>الفصول</summary>
              <div className="study-chapters">{shownChapters.map(item => <label key={item.id}>
                <input type="checkbox" checked={selected.includes(item.id)} onChange={event => {
                  setSelected(items => event.target.checked ? [...items, item.id] : items.filter(id => id !== item.id))
                  setTopic('')
                }} /> <bdi dir="ltr">{item.id} · {item.title}</bdi>
              </label>)}</div>
            </details>
          </>}
          <label>نوع التدريب
            <select aria-label="نوع التدريب" value={type} onChange={event => setType(event.target.value as StudyFilter['type'])}>
              <option value="all">جميع الأنواع</option>
              {studyTypes.map(key => <option key={key} value={key}>{names[key]}</option>)}
            </select>
          </label>
          <label>موضوع القواعد
            <select aria-label="موضوع القواعد" value={topic} onChange={event => setTopic(event.target.value)}>
              <option value="">جميع الموضوعات المتاحة</option>
              {pack.lessons.filter(lesson => (!scope.length || scope.includes(lesson.chapter)) &&
                (view === 'chapter' || level === 'all' || lesson.chapter.startsWith(level + ':')))
                .map(lesson => <option key={lesson.topic} value={lesson.topic}>{lesson.chapter} · {lesson.title}</option>)}
            </select>
          </label>
          {type === 'flashcard' && vocabulary && <>
            <label>وجه البطاقة
              <select value={flashcardMode} onChange={event => setFlashcardMode(event.target.value as FlashcardMode)}>
                {Object.entries(flashcardModes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <label><input type="checkbox" checked={automatic} onChange={event => setAutomatic(event.target.checked)} />
              إدراج المفردات المتحقّق منها آليًا</label>
          </>}
          <p role="status">{number.format(pool.length)} نشاطًا في النطاق المختار.</p>
          <label>عدد الأنشطة
            <select value={count} onChange={event => setCount(Number(event.target.value))}>
              {[5, 10, 20, 50].map(value => <option key={value} value={value}>{number.format(value)}</option>)}
            </select>
          </label>
          <button className="button primary" type="button" disabled={!playable.length}
            onClick={() => setSession(studyRound(playable, count))}>ابدأ التدريب</button>
        </section>
        {view === 'chapter' && chapter && <ChapterOverview chapter={chapter} pack={pack} />}
      </div>
    </>}
  </main>
}
