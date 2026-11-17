import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChapterOverview } from './ChapterOverview'
import { Icon } from './icons'
import { PracticeSetup, arabicNumber, levelName } from './PracticeSetup'
import { StudyExercise } from './StudyExercise'
import { StudyBackup } from './StudyProgress'
import { LearningAnalytics, LearningDashboard, type Suggestion } from './LearningAnalytics'
import { MistakeNotebook } from './MistakeNotebook'
import { adaptiveRound, buildEvidence, difficultyByActivity, reviewOrder } from './learning-model'
import { matchingCandidates } from './matching'
import { activities, chapterLevel, eligiblePractice, fromStudyQuestion, levelMatches, loadPracticePreferences,
  practiceChapters, practiceRound, questionGroups, selectedChapters, setChapters, type Activity, type Candidate, type Preferences } from './practice'
import { flashcardCandidates, vocabularyCandidates } from './practice-vocabulary'
import { flashcardModes, type FlashcardMode } from './study-flashcards'
import type { StudyPack, StudyQuestion } from './study-content'
import { studyAssessment } from './study-engine'
import { loadStudyProgress, makeStudyEvent, type StudyEvent, type StudyResult } from './study-progress'
import { loadAttempt, readLocal, writeLocal, type Theme } from './storage'
import type { PersonalQuiz } from './personal-quiz'
import { initialPosition, loadPracticeSession, savePracticeResponse, storePracticePlan, storePracticePosition,
  type PracticePlan, type PracticePosition } from './practice-session'

export type PracticeScreen = 'home' | 'setup' | 'settings' | 'chapters' | 'progress' | 'practice' | 'mistakes'
const preferenceKey = 'practice-preferences'
const assessmentTypes = new Set(['reading', 'cloze', 'verb', 'grammar', 'case', 'vocabulary'])

export function UnifiedPractice({ screen, navigate, bank, pack, contentLoading, importControls, theme, changeTheme }: {
  screen: PracticeScreen | null; navigate: (screen: PracticeScreen) => void; bank: PersonalQuiz | null;
  pack: StudyPack | null; contentLoading: boolean; importControls: ReactNode; theme: Theme; changeTheme: (theme: Theme) => void;
}) {
  const [prefs, setPrefs] = useState(() => loadPracticePreferences(readLocal(preferenceKey), readLocal('quiz-settings')))
  const [progressError, setProgressError] = useState('')
  const [events, setEvents] = useState<StudyEvent[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [now, setNow] = useState(Date.now)
  const [dailyGoal, setDailyGoal] = useState(() => {
    const value = Number(readLocal('daily-goal'))
    return [5, 10, 20, 30].includes(value) ? value : 0
  })
  const [session, setSession] = useState<{ plan: PracticePlan; position: PracticePosition } | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [sessionFinished, setSessionFinished] = useState(false)
  const [openChapter, setOpenChapter] = useState('')
  const expanded = prefs.reliability === 'with-automatic'
  const setup = screen === 'setup' || (screen === 'practice' && !session && !sessionLoading)

  useEffect(() => writeLocal(preferenceKey, JSON.stringify(prefs)), [prefs])
  useEffect(() => {
    if (dailyGoal || readLocal('daily-goal') !== null) writeLocal('daily-goal', String(dailyGoal))
  }, [dailyGoal])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
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
    }).finally(() => { if (active) setHistoryLoading(false) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!screen) return
    window.scrollTo(0, 0)
    if (screen !== 'practice') document.querySelector<HTMLElement>('.unified-main h1')?.focus({ preventScroll: true })
  }, [screen, setup])

  async function record(item: StudyQuestion, result: StudyResult, answer: string, position: PracticePosition) {
    if (!session) return false
    const id = session.plan.id
    try {
      const event = makeStudyEvent(item, result, id + ':' + position.index, answer)
      setEvents(await savePracticeResponse(id, position, event))
      setNow(Date.now())
      setProgressError('')
      return true
    } catch {
      setProgressError('تعذّر حفظ النتيجة. اضغط النشاط التالي لإعادة المحاولة.')
      return false
    }
  }

  const chapters = useMemo(() => practiceChapters(bank, pack), [bank, pack])
  const selected = useMemo(() => selectedChapters(chapters, prefs), [chapters, prefs])
  const study = useMemo(() => (pack?.questions ?? []).filter(item => item.type !== 'writing').map(fromStudyQuestion), [pack])
  const vocabularyLevel = prefs.scope === 'A1' ? 'A1' : 'all'
  const vocabulary = useMemo(() => bank ? vocabularyCandidates(bank, vocabularyLevel, expanded) : [], [bank, vocabularyLevel, expanded])
  const cards = useMemo(() => bank ? flashcardCandidates(bank, chapters, prefs.cards, expanded) : [], [bank, chapters, prefs.cards, expanded])
  const matches = useMemo(() => bank ? matchingCandidates(bank, 'all', expanded) : [], [bank, expanded])
  const evidence = useMemo(() => buildEvidence(events), [events])
  const topics = useMemo(() => new Map(pack?.lessons.map(lesson => [lesson.topic, lesson.title])), [pack])
  const schedule = useMemo(() => new Map([...evidence].map(([id, item]) => [id,
    { due: item.due, needsReview: item.errors > 0 && !item.resolved }])), [evidence])
  const practiced = useMemo(() => new Set(events.map(item => item.questionId)), [events])
  const eligible = useMemo(() => eligiblePractice([...study, ...vocabulary, ...cards, ...matches], selected, prefs, practiced, schedule, now),
    [study, vocabulary, cards, matches, selected, prefs, practiced, schedule, now])
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

  const legacyAttempt = useMemo(() => (screen === 'progress' || screen === 'home') && bank ? loadAttempt(readLocal('attempt'), bank.catalogs, bank.revision,
    bank.automaticAvailable ? { getCatalog: bank.getExpandedCatalog, revision: bank.revision } : undefined) : null, [bank, screen])
  const reviewCandidates = useMemo(() => {
    const allVocabulary = bank && vocabularyLevel !== 'all' ? vocabularyCandidates(bank, 'all', expanded) : vocabulary
    const trackedModes = new Set([...evidence.keys()].filter(id => id.startsWith('card:')).map(id => id.split(':')[1]))
    const extraCards = bank ? (Object.keys(flashcardModes) as FlashcardMode[])
      .filter(mode => mode !== prefs.cards && trackedModes.has(mode)).flatMap(mode => flashcardCandidates(bank, chapters, mode, expanded)) : []
    return new Map([...study, ...allVocabulary, ...vocabulary, ...cards, ...extraCards, ...matches].map(item => [item.id, item]))
  }, [bank, vocabularyLevel, expanded, vocabulary, evidence, prefs.cards, chapters, study, cards, matches])
  const dueIds = useMemo(() => reviewOrder([...evidence.values()].filter(item => item.due <= now && reviewCandidates.has(item.id)), now)
    .map(item => item.id), [evidence, now, reviewCandidates])

  function materialize(round: Candidate[]) {
    const scope = new Set(round.map(item => item.chapter))
    const support = difficultyByActivity(events.filter(event => scope.has(event.chapter)))
    return round.map(item => ({ ...item.make(), activity: item.activity,
      part: item.part, support: support.get(item.activity) ?? 'standard' as const }))
  }

  function configure(target: Suggestion) {
    const chapter = chapters.find(item => item.id === target.chapter)
    const scope = chapter?.level ?? (target.chapter === 'A1' || target.chapter === 'A2' ? target.chapter : prefs.scope)
    setPrefs(before => {
      const next = { ...before, scope, topic: target.topic ?? '', focus: 'all' as const,
        direction: 'all' as const, difficulty: 'all' as const, part: target.part ?? 'all' as const,
        activities: target.skill ? [target.skill] : null, variants: undefined }
      if (chapter) return setChapters(next, [chapter.id], scope)
      return { ...next, chapters: { ...next.chapters, [scope]: undefined } }
    })
    navigate('setup')
  }

  function launchReview(ids: string[]) {
    const required = ids.flatMap(id => {
      const candidate = reviewCandidates.get(id)
      return candidate ? [candidate] : []
    })
    const groups = [...questionGroups(required).values()]
    const limit = prefs.count === 'all' ? groups.length : prefs.count
    launch(materialize(groups.slice(0, limit).map(items => items[0])))
  }

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
    const round = adaptiveRound(groups, prefs.count, evidence, now, Math.floor(now / 60_000) ^ events.length)
    const represented = new Set(round.map(item => item.activity))
    const representedChapters = new Set(round.map(item => item.chapter))
    const coverage = { chapters: selected.filter(id => !representedChapters.has(id)),
      activities: [...kinds].filter(kind => !represented.has(kind)).map(kind => activities[kind]) }
    launch(materialize(round), coverage)
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
    navigate('setup')
  }

  function openRule(item: StudyQuestion) {
    const chapter = chapters.find(chapter => chapter.id === item.chapter)
    if (!chapter) return
    setPrefs(before => setChapters({ ...before, scope: chapter.level, topic: item.topic,
      activities: [item.activity ?? item.type], focus: 'all', difficulty: 'all', part: 'all' }, [chapter.id], chapter.level))
    navigate('setup')
  }

  const currentChapter = pack?.chapters.find(item => item.id === openChapter)

  return <main className="site-container main-content unified-main" id="main-content" hidden={screen === null}>
    {progressError && <p className="notice" role="alert">{progressError}</p>}
    {screen === 'home' && <LearningDashboard evidence={evidence} events={events} chapters={chapters} topics={topics}
      now={now} ready={Boolean(bank || pack)} resumable={Boolean(session && !sessionFinished)} goal={dailyGoal}
      historyLoading={historyLoading} canReview={dueIds.length > 0} review={() => launchReview(dueIds)} configure={configure}
      legacyLink={legacyAttempt ? legacyAttempt.finished ? '#/results' : '#/quiz' : undefined} />}
    {setup && <>
      {session && !sessionFinished && <div className="resume-strip"><Icon name="retry" size={18} />
        <span>لديك جلسة تدريب جارية.</span><a href="#/practice">تابع التدريب</a>
      </div>}
      {contentLoading || sessionLoading || historyLoading ? <p role="status" className="panel loading-content">جارٍ فتح محتواك المحفوظ…</p> :
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
        <section className="settings-section">
          <h2>الهدف اليومي <small>اختياري</small></h2>
          <label className="daily-setting">المحاولات اليومية<select value={dailyGoal} onChange={e => setDailyGoal(Number(e.target.value))}>
            <option value={0}>بدون هدف يومي</option>{[5, 10, 20, 30].map(value => <option key={value} value={value}>{arabicNumber(value)} محاولات</option>)}</select></label>
        </section>
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
            navigate('setup')
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
    {screen === 'progress' && <LearningAnalytics events={events} chapters={chapters} topics={topics} now={now} configure={configure}
      legacyLink={legacyAttempt ? legacyAttempt.finished ? '#/results' : '#/quiz' : undefined} />}
    {screen === 'mistakes' && <MistakeNotebook evidence={evidence} candidates={reviewCandidates} chapters={chapters}
      topics={topics} now={now} onReview={launchReview} />}
    {screen === 'practice' && sessionLoading && <p className="panel metric-empty" role="status">جارٍ استعادة الجلسة…</p>}
    {session && <div hidden={screen !== 'practice'}>
      {(Boolean(session.plan.coverage?.chapters.length) || Boolean(session.plan.coverage?.activities.length)) &&
        <details className="coverage-notice"><summary>تغطية الفصول والتمارين في هذه الجلسة</summary>
          {Boolean(session.plan.coverage?.chapters.length) && <p>فصول لم تظهر في هذه الجولة: <bdi dir="ltr">{session.plan.coverage!.chapters.join('، ')}</bdi></p>}
          {Boolean(session.plan.coverage?.activities.length) && <p>أنواع لم تظهر في هذه الجولة: {session.plan.coverage!.activities.join('، ')}</p>}
        </details>}
      <StudyExercise key={session.plan.id} items={session.plan.items} position={session.position}
        close={() => navigate('setup')} onResult={record} onRule={openRule} onRetry={launch}
        onPosition={position => {
          if (position.index === session.plan.items.length) setSessionFinished(true)
          void storePracticePosition(session.plan.id, position).catch(() => setProgressError('تعذّر حفظ موضع الجلسة.'))
        }} />
    </div>}
  </main>
}
