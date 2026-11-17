import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChapterOverview } from './ChapterOverview'
import { Icon } from './icons'
import { PracticeSetup, arabicNumber, levelName } from './PracticeSetup'
import { StudyExercise } from './StudyExercise'
import { StudyBackup, StudyProgress } from './StudyProgress'
import { activities, chapterLevel, eligiblePractice, fromStudyQuestion, levelMatches, loadPracticePreferences,
  practiceChapters, practiceRound, questionGroups, selectedChapters, setChapters, type Activity, type Preferences } from './practice'
import { flashcardCandidates, vocabularyCandidates } from './practice-vocabulary'
import { flashcardModes, type FlashcardMode } from './study-flashcards'
import type { StudyPack, StudyQuestion } from './study-content'
import { studyAssessment } from './study-engine'
import { loadStudyProgress, makeStudyEvent, reviewSchedule, saveStudyProgress, type StudyEvent, type StudyResult } from './study-progress'
import { loadAttempt, readLocal, writeLocal, type Theme } from './storage'
import type { PersonalQuiz } from './personal-quiz'
import { initialPosition, loadPracticeSession, storePracticePlan, storePracticePosition,
  type PracticePlan, type PracticePosition } from './practice-session'

export type PracticeScreen = 'home' | 'settings' | 'chapters' | 'progress' | 'practice'
const preferenceKey = 'practice-preferences'
const assessmentTypes = new Set(['reading', 'cloze', 'verb', 'grammar', 'case', 'vocabulary'])

export function UnifiedPractice({ screen, navigate, bank, pack, contentLoading, importControls, theme, changeTheme }: {
  screen: PracticeScreen | null; navigate: (screen: PracticeScreen) => void; bank: PersonalQuiz | null;
  pack: StudyPack | null; contentLoading: boolean; importControls: ReactNode; theme: Theme; changeTheme: (theme: Theme) => void;
}) {
  const [prefs, setPrefs] = useState(() => loadPracticePreferences(readLocal(preferenceKey), readLocal('quiz-settings')))
  const [progressError, setProgressError] = useState('')
  const [events, setEvents] = useState<StudyEvent[]>([])
  const [session, setSession] = useState<{ plan: PracticePlan; position: PracticePosition } | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [sessionFinished, setSessionFinished] = useState(false)
  const [openChapter, setOpenChapter] = useState('')
  const expanded = prefs.reliability === 'with-automatic'
  const home = screen === 'home' || (screen === 'practice' && !session)

  useEffect(() => writeLocal(preferenceKey, JSON.stringify(prefs)), [prefs])
  useEffect(() => {
    let active = true
    void loadPracticeSession().then(value => {
      if (active && value) {
        setSession(value)
        setSessionFinished(value.position.index === value.plan.items.length)
      }
    }).catch(() => { if (active) setProgressError('تعذّر فتح جلسة التدريب المحفوظة.') }).finally(() => {
      if (active) setSessionLoading(false)
    })
    void loadStudyProgress().then(value => {
      if (active) setEvents(value)
    }).catch(() => {
      if (active) setProgressError('تعذّر فتح التقدم المحفوظ.')
    })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!screen) return
    window.scrollTo(0, 0)
    if (screen !== 'practice') document.querySelector<HTMLElement>('.unified-main h1')?.focus({ preventScroll: true })
  }, [screen, home])

  function record(item: StudyQuestion, result: StudyResult) {
    void saveStudyProgress([makeStudyEvent(item, result)]).then(setEvents)
      .catch(() => setProgressError('تعذّر حفظ النتيجة. تحقّق من مساحة التخزين.'))
  }

  const chapters = useMemo(() => practiceChapters(bank, pack), [bank, pack])
  const selected = useMemo(() => selectedChapters(chapters, prefs), [chapters, prefs])
  const study = useMemo(() => (pack?.questions ?? []).map(fromStudyQuestion), [pack])
  const vocabularyLevel = prefs.scope === 'A1' ? 'A1' : 'all'
  const vocabulary = useMemo(() => bank ? vocabularyCandidates(bank, vocabularyLevel, expanded) : [], [bank, vocabularyLevel, expanded])
  const cards = useMemo(() => bank ? flashcardCandidates(bank, chapters, prefs.cards, expanded) : [], [bank, chapters, prefs.cards, expanded])
  const schedule = useMemo(() => reviewSchedule(events), [events])
  const practiced = useMemo(() => new Set(events.map(item => item.questionId)), [events])
  const eligible = useMemo(() => eligiblePractice([...study, ...vocabulary, ...cards], selected, prefs, practiced, schedule),
    [study, vocabulary, cards, selected, prefs, practiced, schedule])
  const counts = useMemo(() => {
    const byKind = new Map<Activity, Set<string>>()
    for (const item of eligible) {
      if (!byKind.has(item.activity)) byKind.set(item.activity, new Set())
      byKind.get(item.activity)!.add(item.key)
    }
    return new Map([...byKind].map(([key, items]) => [key, items.size]))
  }, [eligible])
  const kinds = useMemo(() => new Set((prefs.activities ?? [...counts.keys()]).filter(kind => counts.has(kind))), [counts, prefs.activities])
  const groups = useMemo(() => questionGroups(eligible.filter(item => kinds.has(item.activity))), [eligible, kinds])
  const missingStudy = !pack
  const missingVocabulary = !bank
  const completeChapters = chapters.filter(chapter => levelMatches(prefs.scope, chapter.level) &&
    study.some(item => item.chapter === chapter.id) &&
    study.every(item => item.chapter !== chapter.id || practiced.has(item.id)))

  const legacyAttempt = useMemo(() => screen === 'progress' && bank ? loadAttempt(readLocal('attempt'), bank.catalogs, bank.revision,
    bank.automaticAvailable ? { getCatalog: bank.getExpandedCatalog, revision: bank.revision } : undefined) : null, [bank, screen])
  const additional = useMemo(() => {
    if (screen !== 'progress' || !bank || !events.length) return []
    const reviewIds = new Set([...schedule].filter(([, value]) => value.needsReview || value.due <= Date.now()).map(([id]) => id))
    const candidates = vocabularyLevel === 'all' ? vocabulary : vocabularyCandidates(bank, 'all', expanded)
    const otherModes = (Object.keys(flashcardModes) as FlashcardMode[])
      .filter(mode => mode !== prefs.cards && [...reviewIds].some(id => id.startsWith('card:' + mode + ':')))
    return [...candidates, ...cards, ...otherModes.flatMap(mode => flashcardCandidates(bank, chapters, mode, expanded))]
      .filter(item => reviewIds.has(item.id)).map(item => item.make())
  }, [screen, bank, events, schedule, vocabularyLevel, vocabulary, cards, prefs.cards, chapters, expanded])

  function launch(items: StudyQuestion[], coverage?: PracticePlan['coverage']) {
    if (!items.length) return
    if (session && !sessionFinished && screen !== 'practice' &&
        !window.confirm('هل تريد بدء تدريب جديد؟ تقدّمك المسجّل محفوظ، وستنتهي الجلسة الحالية.')) return
    const plan = { id: crypto.randomUUID(), items, coverage }
    setSession({ plan, position: initialPosition })
    setSessionFinished(false)
    void storePracticePlan(plan).catch(() => setProgressError('تعذّر حفظ هذه الجلسة لاستئنافها لاحقًا.'))
    navigate('practice')
    window.scrollTo(0, 0)
  }

  function startPractice() {
    const round = practiceRound(groups, prefs.count)
    const represented = new Set(round.map(item => item.activity))
    const representedChapters = new Set(round.map(item => item.chapter))
    const coverage = { chapters: selected.filter(id => !representedChapters.has(id)),
      activities: [...kinds].filter(kind => !represented.has(kind)).map(kind => activities[kind]) }
    launch(round.map(item => item.make()), coverage)
  }

  function assess(chapter: string, testStyle = false) {
    const pool = [...study, ...vocabulary].filter(item => item.chapter === chapter &&
      item.activity !== 'flashcard' && item.activity !== 'writing' && (!testStyle || assessmentTypes.has(item.activity)))
    const candidates = practiceRound(questionGroups(pool), 'all').map(item => item.make())
    launch(studyAssessment(candidates, prefs.count === 'all' ? candidates.length : prefs.count))
  }

  function chooseChapter(id: string) {
    const chapter = chapters.find(item => item.id === id)
    if (!chapter) return
    setPrefs(before => setChapters({ ...before, scope: chapter.level, topic: '' }, [chapter.id], chapter.level))
    navigate('home')
  }

  function openRule(item: StudyQuestion) {
    const chapter = chapters.find(chapter => chapter.id === item.chapter)
    if (!chapter) return
    setPrefs(before => setChapters({ ...before, scope: chapter.level, topic: item.topic,
      activities: [item.type], focus: 'all', difficulty: 'all', part: 'all' }, [chapter.id], chapter.level))
    navigate('home')
  }

  function retryProgress(items: StudyQuestion[]) {
    launch(practiceRound(questionGroups(items.map(fromStudyQuestion)), prefs.count).map(item => item.make()))
  }

  const currentChapter = pack?.chapters.find(item => item.id === openChapter)
  const dueCards = [...(pack?.questions ?? []), ...additional].filter(item => item.type === 'flashcard' &&
    (schedule.get(item.id)?.due ?? Infinity) <= Date.now())
  const chart = screen === 'progress' ? chapters.map(chapter => ({
    chapter, completed: new Set(events.filter(event => event.chapter === chapter.id).map(event => event.questionId)).size,
  })).filter(({ completed }) => completed > 0) : []

  return <main className="site-container main-content unified-main" id="main-content" hidden={screen === null}>
    {progressError && <p className="notice" role="alert">{progressError}</p>}
    {home && <>
      {session && !sessionFinished && <div className="resume-strip"><Icon name="retry" size={18} />
        <span>لديك جلسة تدريب جارية.</span><a href="#/practice">تابع التدريب</a>
      </div>}
      {contentLoading || sessionLoading ? <p role="status" className="panel loading-content">جارٍ فتح محتواك المحفوظ…</p> :
        <PracticeSetup prefs={prefs} update={setPrefs} chapters={chapters} selected={selected} kinds={kinds}
          counts={counts} entries={bank?.dataset.entries.length ?? 0} available={groups.size}
          start={startPractice} missingStudy={missingStudy}
          missingVocabulary={missingVocabulary} lessons={pack?.lessons.filter(lesson => selected.includes(lesson.chapter as typeof selected[number])) ?? []}
          completeChapters={completeChapters} />}
    </>}
    {screen === 'settings' && <>
      <div className="practice-heading"><h1 tabIndex={-1}>الإعدادات</h1><p>مظهر التطبيق وملفاتك المحفوظة على هذا الجهاز.</p></div>
      <div className="panel settings-panel">
        <section className="settings-section">
          <h2>المظهر</h2>
          <div className="settings-options" role="group" aria-label="المظهر">
            <button type="button" className="button secondary" aria-pressed={theme === 'light'} onClick={() => changeTheme('light')}>
              <Icon name="sun" size={18} /> فاتح</button>
            <button type="button" className="button secondary" aria-pressed={theme === 'dark'} onClick={() => changeTheme('dark')}>
              <Icon name="moon" size={18} /> داكن</button>
          </div>
        </section>
        {bank?.automaticAvailable && <section className="settings-section">
          <h2>مصادر المفردات في التدريب</h2>
          <label className="settings-option"><input type="radio" name="reliability" checked={!expanded}
            onChange={() => setPrefs(before => ({ ...before, reliability: 'reviewed' }))} /> المفردات المراجَعة فقط</label>
          <label className="settings-option"><input type="radio" name="reliability" checked={expanded}
            onChange={() => setPrefs(before => ({ ...before, reliability: 'with-automatic' }))} /> المراجَعة والمتحقّق منها آليًا</label>
          <p className="setup-helper">المفردات المتحقّق منها آليًا قد لا تكون راجعتْها يدويًا جهة مختصّة.</p>
        </section>}
        {importControls}
        <StudyBackup vocabulary={bank?.dataset ?? null} pack={pack} events={events} update={setEvents} />
        <details className="settings-section"><summary>العمل دون اتصال والتخزين</summary>
          <p>تُحفظ الملفات والتقدم على هذا المتصفح. بعد اكتمال تحميل التطبيق يمكنك متابعة التدريب دون اتصال. احتفظ بنسخة احتياطية لنقل بياناتك إلى جهاز آخر.</p>
        </details>
      </div>
    </>}
    {screen === 'chapters' && <>
      <div className="practice-heading"><h1 tabIndex={-1}>دروس الفصول</h1><p>تصفّح الأهداف والقواعد قبل التدريب أو التقييم.</p></div>
      {pack ? <div className="chapter-page-grid">
        <nav className="panel chapter-navigation" aria-label="دروس الفصول">
          {(['A1', 'A2'] as const).map(level => <div key={level}><bdi className="chapter-group-level" dir="ltr">{levelName(level)}</bdi>
            {pack.chapters.filter(item => chapterLevel(item.id) === level).map(item =>
              <button key={item.id} type="button" aria-pressed={openChapter === item.id}
                onClick={() => setOpenChapter(item.id)}><span>{arabicNumber(item.number)}</span><bdi lang="de" dir="ltr">{item.title}</bdi></button>)}
          </div>)}
        </nav>
        {currentChapter ? <div className="study-flow">
          <ChapterOverview chapter={currentChapter} pack={pack} events={events} onRule={(chapter, topic) => {
            setPrefs(before => setChapters({ ...before, scope: chapterLevel(chapter), topic, activities: null,
              focus: 'all', difficulty: 'all', part: 'all' }, [chapter as typeof selected[number]], chapterLevel(chapter)))
            navigate('home')
          }} />
          <div className="study-actions">
            <button type="button" className="button primary" onClick={() => chooseChapter(currentChapter.id)}>اختر الفصل للتدريب</button>
            <button type="button" className="button secondary" onClick={() => assess(currentChapter.id)}
              disabled={!pack.questions.some(item => item.chapter === currentChapter.id && item.type !== 'flashcard' && item.type !== 'writing')}>تقييم الفصل</button>
            <button type="button" className="button secondary" onClick={() => assess(currentChapter.id, true)}
              disabled={!pack.questions.some(item => item.chapter === currentChapter.id && assessmentTypes.has(item.type))}>مراجعة بأسلوب الاختبار</button>
          </div>
        </div> : <section className="panel practice-empty"><Icon name="book" size={28} /><h2>اختر فصلًا لعرض دروسه</h2></section>}
      </div> : <section className="panel practice-empty">
        <h2>{contentLoading ? 'جارٍ فتح الدروس…' : 'استورد ملف المحتوى لفتح الدروس'}</h2>
        {!contentLoading && <a className="button primary" href="#/settings">فتح إعدادات المحتوى</a>}
      </section>}
    </>}
    {screen === 'progress' && <div className="study-flow">
      <div className="practice-heading"><h1 tabIndex={-1}>تقدّمك</h1><p>تابع إنجازك وراجع ما يحتاج إلى مزيد من التدريب.</p></div>
      <div className="study-actions">
        {session && !sessionFinished && <a className="button primary" href="#/practice">تابع التدريب</a>}
        {dueCards.length > 0 && <button className="button secondary" type="button" onClick={() => retryProgress(dueCards)}>
          البطاقات المستحقّة · {arabicNumber(new Set(dueCards.map(item => item.id)).size)}</button>}
        {legacyAttempt && <a className="button secondary" href={legacyAttempt.finished ? '#/results' : '#/quiz'}>
          {legacyAttempt.finished ? 'نتيجة اختبار المفردات السابق' : 'تابع اختبار المفردات المحفوظ'}</a>}
        {bank && <a className="button secondary" href="#/vocabulary">افتح القاموس</a>}
      </div>
      <StudyProgress pack={pack} additional={additional} events={events} update={setEvents} retry={retryProgress} />
      {chart.length > 0 && <section className="panel study-flow">
        <h2>التقدّم حسب الفصل</h2>
        <ul className="chapter-progress">{chart.map(({ chapter, completed }) => <li key={chapter.id}>
          <bdi dir="ltr">{chapter.id} {chapter.title}</bdi><span>{arabicNumber(completed)} نشاطًا</span>
        </li>)}</ul>
      </section>}
    </div>}
    {session && <div hidden={screen !== 'practice'}>
      {(Boolean(session.plan.coverage?.chapters.length) || Boolean(session.plan.coverage?.activities.length)) &&
        <details className="coverage-notice"><summary>تغطية الفصول والتمارين في هذه الجلسة</summary>
          {Boolean(session.plan.coverage?.chapters.length) && <p>فصول لم تظهر في هذه الجولة: <bdi dir="ltr">{session.plan.coverage!.chapters.join('، ')}</bdi></p>}
          {Boolean(session.plan.coverage?.activities.length) && <p>أنواع لم تظهر في هذه الجولة: {session.plan.coverage!.activities.join('، ')}</p>}
        </details>}
      <StudyExercise key={session.plan.id} items={session.plan.items} position={session.position}
        close={() => navigate('home')} onResult={record} onRule={openRule} onRetry={launch}
        onPosition={position => {
          if (position.index === session.plan.items.length) setSessionFinished(true)
          void storePracticePosition(session.plan.id, position).catch(() => setProgressError('تعذّر حفظ موضع الجلسة.'))
        }} />
    </div>}
  </main>
}
