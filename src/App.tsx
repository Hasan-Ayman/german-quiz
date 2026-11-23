import {analyticsQuestionIndex,legacyQuestionInfo} from './answer-analytics'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { Icon } from './icons'
import { educationImportMessage, readEducationFile, validateEducationPackage } from './education-package'
import { factType, preparePersonalQuiz, selectedPersonalCatalog, type PersonalQuiz } from './personal-quiz'
import { loadEducationLibrary, saveEducationPackage } from './education-storage'
import type { StudyPack, StudyQuestion } from './study-content'
import { useAppUpdate } from './pwa'
import {ImportProblem} from './import-problem'
import { EducationImport, type ImportStatus } from './EducationImport'
import { QuizFilters } from './QuizFilters'
import { UnifiedPractice, type PracticeScreen } from './UnifiedPractice'
import { loadPracticePreferences, levelMatches, type Scope } from './practice'
import { grammarTypes, isGrammarMode } from './question-types'
import { feedbackExamples, isLevel, isReliability, levels, type ExampleSentence, type Level, type PilotEntry } from './pilot'
import {
  answer, incorrectAnswers, isCorrect, isQuestionCount, makeQuiz, modes, newAttempt,
  nextQuestion, questionCounts, retryQuiz, type Attempt, type Mode, type Text,
} from './quiz'
import { loadQuizSettings, loadTheme, readLocal, writeLocal, type QuizSettings } from './storage'
import { useLegacySession } from './useLegacySession'
import {SimpleLearning,LearningDataTools,ChapterLabel,ArabicExplanation,type SimpleScreen} from './SimpleLearning'
import {buildLearningLibrary,validateQuestionFeedback,type ExplanationSupplement,type QuestionFeedback} from './learning-library'

const numbers = new Intl.NumberFormat('ar-u-nu-arab')
const percentages = new Intl.NumberFormat('ar-u-nu-arab', { style: 'percent', maximumFractionDigits: 0 })
const number = (value: number) => numbers.format(value)

const modeInfo = {
  'de-ar': { name: 'ألماني إلى عربي', instruction: 'اختر المعنى بالعربية', icon: 'swap', tone: 'mint' },
  'ar-de': { name: 'عربي إلى ألماني', instruction: 'اختر الكلمة بالألمانية', icon: 'swap', tone: 'blue' },
  article: { name: 'أدوات التعريف', instruction: 'اختر أداة التعريف المناسبة', icon: 'article', tone: 'amber' },
  verb: { name: 'ترجمة الأفعال', instruction: 'اختر معنى الفعل بالعربية', icon: 'verb', tone: 'lavender' },
  adjective: { name: 'ترجمة الصفات', instruction: 'اختر معنى الصفة بالعربية', icon: 'adjective', tone: 'rose' },
} as const

function modeDetails(mode: Mode) {
  if (!isGrammarMode(mode)) return modeInfo[mode]
  const [part, name, instruction] = grammarTypes[mode]
  const style = part === 'verb' ? modeInfo.verb : part === 'adjective' ? modeInfo.adjective : modeInfo.article
  return { ...style, name, instruction }
}

type Screen = PracticeScreen | SimpleScreen | 'quiz' | 'results' | 'review' | 'vocabulary' | 'legacy-setup'

function readScreen(): Screen {
  const name = window.location.hash.slice(2).split('?')[0]
  if (name === 'study') return 'home'
  return name === 'quiz' || name === 'results' || name === 'review' || name === 'vocabulary' ||
    name === 'settings' || name === 'chapters' || name === 'progress' || name === 'practice' ||
    name === 'analytics' || name === 'setup' || name === 'mistakes' || name === 'questions' || name === 'test' || name === 'test-results' || name === 'test-review' || name === 'legacy-setup' ? name : 'home'
}

function subscribeScreen(callback: () => void) {
  window.addEventListener('hashchange', callback)
  return () => window.removeEventListener('hashchange', callback)
}

function navigate(screen: Screen) {
  window.location.hash = screen === 'home' ? '/' : '/' + screen
}

export function LanguageText({ text, lang }: Text) {
  return <bdi lang={lang} dir={lang === 'de' ? 'ltr' : 'rtl'}>{text}</bdi>
}

function ModeLabel({ mode }: { mode: Mode }) {
  const info = modeDetails(mode)
  return <span className={'mode-badge ' + info.tone}><Icon name={info.icon} size={16} />{info.name}</span>
}

function VocabularyDetail({ entry }: { entry: PilotEntry }) {
  return (
    <div className="vocabulary-detail">
      <strong><LanguageText lang="de" text={entry.article ? entry.article + ' ' + entry.german : entry.german} /></strong>
      <span className="detail-divider" aria-hidden="true" />
      <LanguageText lang="ar" text={entry.arabic_translations.join(' / ')} />
    </div>
  )
}

function ExampleFeedback({ example }: { example: ExampleSentence }) {
  return (
    <section className="example-feedback" aria-label="جملة مثال">
      <div className="example-heading">
        <h2>جملة مثال</h2>
        <span>{example.origin === 'source_pdf' ? 'من المصدر' : 'مثال مؤلَّف'}
          </span>
      </div>
      <p lang="de" dir="ltr">{example.german}</p>
      {example.origin === 'source_pdf' && example.arabicOrigin === 'authored' &&
        <small>ترجمة عربية مضافة</small>}
      {example.arabic && <p lang="ar" dir="rtl">{example.arabic}</p>}
      {example.verification_status === 'needs_review' && <small>الترجمة قيد المراجعة</small>}
    </section>
  )
}

function EntryExamples({ entry, level, preferred, compact = false }: {
  entry: PilotEntry; level: Level; preferred?: string; compact?: boolean
}) {
  const examples = feedbackExamples(entry.examples, level)
  const used = examples.findIndex(example => example.german === preferred)
  if (used > 0) examples.unshift(...examples.splice(used, 1))
  const count = compact && !examples.some(example => example.source_type) ? 1 : 2
  return <>
    {examples.slice(0, count).map(example => <ExampleFeedback key={example.german} example={example} />)}
    {examples.length > count && <details className="extra-examples">
      <summary>أمثلة إضافية</summary>
      {examples.slice(count).map(example => <ExampleFeedback key={example.german} example={example} />)}
    </details>}
  </>
}

function RoundLimit({ requested, actual }: { requested: number; actual: number }) {
  return (
    <p className="notice" role="status">
      طلبت {number(requested)} سؤالًا. الحد المتاح من المجموعة المختارة لهذا المستوى دون تكرار هو {number(actual)}.
    </p>
  )
}

function Home({ bank, attempt, settings, updateSettings, start }: {
  bank: PersonalQuiz
  attempt: Attempt | null
  settings: QuizSettings
  updateSettings: (settings: QuizSettings) => void
  start: () => void
}) {
  const catalog = selectedPersonalCatalog(bank, settings)
  const eligibleCount = catalog.entryCount
  const expanded = bank.automaticAvailable
  const availableCount = Math.min(settings.count, eligibleCount)
  const availableTypes = bank.chapters ? new Set([...selectedPersonalCatalog(bank, { ...settings, types: undefined })
    .facts.values()].map(factType)) : undefined
  return (
    <>
      <section className="hero" aria-labelledby="home-title">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot" /> تدريب المفردات <span aria-hidden="true">·</span> <bdi dir="ltr">A1–A2</bdi></div>
          <h1 id="home-title">تدرّب على الألمانية<br /><span>كلمةً بكلمة.</span></h1>
          <p>اختبر مفرداتك الألمانية في جولة قصيرة تجمع الترجمة وأدوات التعريف، وراجع إجاباتك بعد كل سؤال.</p>
          <div className="quiz-settings" role="group" aria-label="إعدادات الاختبار">
            <label>
              مستوى المفردات
              <select value={settings.level} aria-describedby="pilot-availability" onChange={event => {
                const level = event.target.value
                if (isLevel(level)) updateSettings({ ...settings, level,
                  chapters: level === 'A1' ? settings.chapters?.filter(key => key.startsWith('A1:')) : settings.chapters })
              }}>
                {levels.map(level => <option key={level} value={level}>{level}</option>)}
              </select>
            </label>
            <label>
              عدد الأسئلة
              <select value={settings.count} onChange={event => {
                const count = Number(event.target.value)
                if (isQuestionCount(count)) updateSettings({ ...settings, count })
              }}>
                {questionCounts.map(count => <option key={count} value={count}>{number(count)}</option>)}
              </select>
            </label>

          </div>
          {availableTypes && <QuizFilters bank={bank} settings={settings} update={updateSettings} available={availableTypes} />}

          <p className="notice" id="pilot-availability" aria-live="polite">
            تضمّ المجموعة المختارة {number(eligibleCount)} مفردة مؤهّلة لهذا المستوى.
            {' '}يشمل <bdi dir="ltr">A2</bdi> مفردات <bdi dir="ltr">A1</bdi> و<bdi dir="ltr">A2</bdi>.
          </p>
          {availableCount === 0 && <p className="notice" role="status">لا توجد أسئلة مؤهّلة لهذا المستوى حاليًا.</p>}
          {availableCount > 0 && availableCount < settings.count &&
            <RoundLimit requested={settings.count} actual={availableCount} />}
          <div className="actions">
            <button className="button primary" type="button" onClick={start} disabled={availableCount === 0}>
              ابدأ اختبارًا عشوائيًا <Icon name="left" />
            </button>
            {attempt && (
              <a className="button secondary" href={attempt.finished ? '#/results' : '#/quiz'}>
                {attempt.finished ? 'عرض آخر نتيجة' : 'متابعة الاختبار'}
              </a>
            )}
            <a className="button secondary" href="#/vocabulary">مراجعة المفردات</a>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="art-orbit orbit-one" />
          <div className="art-orbit orbit-two" />
          <div className="art-spark">✦</div>
          <div className="art-cards">
            <div className="art-back" />
            <div className="art-front" dir="ltr" lang="de">
              <span className="art-flag"><i /><i /><i /></span>
              <span className="art-letter">Ä</span>
              <span className="art-caption">DEUTSCH</span>
            </div>
          </div>
          <div className="art-pill" dir="ltr" lang="de"><span>der</span><span>die</span><span>das</span></div>
        </div>
        <div className="hero-meta">
          <span><Icon name="list" size={17} /> أسئلة الجولة <strong>{number(availableCount)}</strong></span>
          <span><Icon name="shuffle" size={17} /> {number(availableTypes ? new Set([...catalog.facts.values()].map(factType)).size : modes.length)} أنواع من الأسئلة</span>
          <span><Icon name="retry" size={17} /> إعادة المحاولة للأخطاء</span>
        </div>
      </section>
      {!bank.chapters && <section className="modes" aria-labelledby="modes-title">
        <div className="section-heading">
          <h2 id="modes-title">ماذا ستتدرّب عليه؟</h2>
          <p>مزيج مختلف من الأسئلة في كل جولة.</p>
        </div>
        <div className="mode-grid">
          {modes.map(mode => {
            const info = modeInfo[mode]
            return (
              <div className="mode-tile" key={mode}>
                <span className={'tile-icon ' + info.tone}><Icon name={info.icon} /></span>
                <span>{info.name}</span>
              </div>
            )
          })}
        </div>
      </section>}
    </>
  )
}

export function QuizPanel({ attempt, select, advance, concise = false, detail }: {
  attempt: Attempt
  select: (id: string) => void
  advance: () => void
  concise?: boolean
  detail?: StudyQuestion
}) {
  const current = attempt.questions[attempt.index]
  const total = attempt.questions.length
  const selected = attempt.answers[attempt.index]
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
  }, [current.id])

  return (
    <section className="workspace quiz-page" aria-label="الاختبار">
      <div className="page-top">
        <a className="back-link" href="#/"><Icon name="right" size={18} /> الرئيسية</a>
        <span className="round-label">{attempt.kind === 'retry' ? 'إعادة المحاولة' : 'اختبار عشوائي'}</span>
      </div>
      <div className="progress-area">
        <span>السؤال {number(attempt.index + 1)} من {number(total)}</span>
        <progress max={total} value={attempt.index + (selected ? 1 : 0)} aria-label="تقدّم الاختبار" />
        {attempt.kind === 'random' && total < attempt.requestedCount &&
          <RoundLimit requested={attempt.requestedCount} actual={total} />}
      </div>
      <article className="panel question-panel">
        <div className="question-header">
          {detail&&<p><ChapterLabel chapter={detail.chapter}/></p>}
          <ModeLabel mode={current.mode} />
          <p className="question-instruction">{modeDetails(current.mode).instruction}</p>
          <h1 tabIndex={-1} ref={heading}><LanguageText {...current.prompt} /></h1>
          {current.hint && <p className="question-instruction">المعنى المقصود: <LanguageText {...current.hint} /></p>}
        </div>
        <div className="choices" role="group" aria-label="الخيارات">
          {current.choices.map((choice, index) => {
            const correct = Boolean(selected && isCorrect(current, choice.id))
            const wrong = Boolean(selected && selected === choice.id && !correct)
            const className = correct ? 'choice correct' : wrong ? 'choice wrong' : 'choice'
            return (
              <button key={choice.id} className={className} type="button"
                aria-disabled={Boolean(selected)} onClick={() => !selected && select(choice.id)}>
                <span className="choice-index" aria-hidden="true">{number(index + 1)}</span>
                <span className="choice-text"><LanguageText {...choice} /></span>
                {correct && <span className="choice-result"><Icon name="check" /><span className="sr-only">الإجابة الصحيحة</span></span>}
                {wrong && <span className="choice-result"><Icon name="cross" /><span className="sr-only">إجابتك الخاطئة</span></span>}
              </button>
            )
          })}
        </div>
        {selected && (
          <div className={'feedback ' + (isCorrect(current, selected) ? 'positive' : 'negative')}>
            <div role="status" className="feedback-content">
              <strong className="feedback-title">
                <Icon name={isCorrect(current, selected) ? 'check' : 'cross'} size={18} />
                {isCorrect(current, selected) ? 'إجابة صحيحة!' : 'إجابة غير صحيحة'}
              </strong>
              {detail?.explanation&&<ArabicExplanation text={detail.explanation}/>}
              {(!concise || !isCorrect(current, selected)) && <>
                <VocabularyDetail entry={current.entry} />
                <EntryExamples entry={current.entry} level={attempt.level} preferred={current.exampleGerman} compact />
              </>}
            </div>
            <button className="button primary next-button" type="button" onClick={advance}>
              {attempt.index + 1 === total ? 'عرض النتيجة' : 'السؤال التالي'} <Icon name="left" size={18} />
            </button>
          </div>
        )}
      </article>
      {!selected && <p className="quiz-note">اختر إجابة واحدة لتظهر لك النتيجة.</p>}
    </section>
  )
}

function MistakeList({ attempt, detailed }: { attempt: Attempt; detailed: boolean }) {
  const mistakes = incorrectAnswers(attempt)
  return (
    <ul className="mistakes">
      {mistakes.map(({ question, selected }) => {
        const correct = question.choices.find(choice => choice.id === question.correctId)!
        return (
          <li className="mistake" key={question.id}>
            <div className="mistake-heading">
              <strong><LanguageText {...question.prompt} /></strong>
              <ModeLabel mode={question.mode} />
            </div>
            <dl className="mistake-answers">
              <div><dt>إجابتك</dt><dd className="wrong-text"><LanguageText {...selected} /></dd></div>
              <div><dt>الإجابة الصحيحة</dt><dd className="correct-text"><LanguageText {...correct} /></dd></div>
            </dl>
            {detailed && <>
              <VocabularyDetail entry={question.entry} />
              <EntryExamples entry={question.entry} level={attempt.level} preferred={question.exampleGerman} />
            </>}
          </li>
        )
      })}
    </ul>
  )
}

export function Results({ attempt, start, retry }: { attempt: Attempt; start: () => void; retry: () => void }) {
  const total = attempt.questions.length
  const wrong = incorrectAnswers(attempt).length
  const correct = total - wrong
  const accuracy = correct / total
  return (
    <section className="workspace results-page" aria-labelledby="results-title">
      <div className="page-top">
        <a className="back-link" href="#/"><Icon name="right" size={18} /> الرئيسية</a>
        <span className="round-label">ملخّص الجولة</span>
      </div>
      <article className="panel result-panel">
        <div className="result-intro">
          <div>
            <div className="eyebrow"><span className="eyebrow-dot" /> اكتملت الجولة</div>
            <h1 id="results-title" tabIndex={-1}>نتيجة الاختبار</h1>
            <p>{wrong ? 'راجع إجاباتك الخاطئة وأعد المحاولة متى شئت.' : 'أجبت عن جميع الأسئلة بشكل صحيح.'}</p>
          </div>
          <div className="score-ring" style={{ '--accuracy': accuracy * 100 + '%' } as CSSProperties}>
            <div><strong>{percentages.format(accuracy)}</strong><span>الدقّة</span></div>
          </div>
        </div>
        <dl className="stats">
          <div><dt>مجموع الأسئلة</dt><dd>{number(total)}</dd></div>
          <div><dt>إجابات صحيحة</dt><dd className="correct-text">{number(correct)}</dd></div>
          <div><dt>إجابات خاطئة</dt><dd className="wrong-text">{number(wrong)}</dd></div>
        </dl>
        <div className="actions">
          <button className="button primary" type="button" onClick={start}><Icon name="shuffle" /> ابدأ اختبارًا جديدًا</button>
          {wrong > 0 && <button className="button secondary" type="button" onClick={retry}><Icon name="retry" /> أعد الأسئلة الخاطئة</button>}
        </div>
      </article>
      {wrong > 0 && (
        <section className="result-mistakes" aria-labelledby="mistakes-title">
          <div className="section-heading with-action">
            <h2 id="mistakes-title">الإجابات الخاطئة <span className="counter">{number(wrong)}</span></h2>
            <a className="back-link" href="#/review">مراجعة الإجابات <Icon name="left" size={18} /></a>
          </div>
          <MistakeList attempt={attempt} detailed={false} />
        </section>
      )}
    </section>
  )
}

function Review({ attempt, retry }: { attempt: Attempt; retry: () => void }) {
  const wrong = incorrectAnswers(attempt).length
  return (
    <section className="workspace review-page" aria-labelledby="review-title">
      <div className="page-top">
        <a className="back-link" href="#/results"><Icon name="right" size={18} /> العودة إلى النتيجة</a>
        <span className="round-label">المراجعة</span>
      </div>
      <div className="panel review-heading">
        <div>
          <h1 id="review-title" tabIndex={-1}>مراجعة الإجابات الخاطئة</h1>
          <p>قارن إجاباتك بالمعاني الصحيحة، ثم أعد الأسئلة نفسها.</p>
        </div>
        <button className="button primary" type="button" onClick={retry}>
          <Icon name="retry" /> أعد المحاولة <span className="retry-count">{number(wrong)}</span>
        </button>
      </div>
      <MistakeList attempt={attempt} detailed />
    </section>
  )
}

function VocabularyReview({ bank, scope, reliability }: { bank: PersonalQuiz; scope: Scope; reliability: QuizSettings['reliability'] }) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const entries = bank.dataset.entries.filter(entry =>
    entry.levels.some(level => levelMatches(scope, level)) &&
    (reliability === 'with-automatic' || entry.vocabularyStatus === 'reviewed') &&
    [entry.german, ...entry.arabic_translations].some(text =>
      text.normalize('NFC').toLocaleLowerCase().includes(query.trim().normalize('NFC').toLocaleLowerCase())))
  const pageSize = 12
  return <section className="workspace review-page" aria-labelledby="vocabulary-review-title">
    <div className="page-top"><a className="back-link" href="#/"><Icon name="right" size={18} /> الرئيسية</a></div>
    <div className="panel review-heading">
      <div>
        <h1 id="vocabulary-review-title" tabIndex={-1}>القاموس</h1>
        <label className="vocabulary-search">بحث بالعربية أو الألمانية
          <input type="search" dir="auto" value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} />
        </label>
      </div>
    </div>
    {entries.length === 0 && <p role="status">لا توجد مفردات تطابق البحث.</p>}
    <ul className="mistakes">
      {entries.slice(page * pageSize, (page + 1) * pageSize).map(entry => <li className="mistake" key={entry.id}>
        <VocabularyDetail entry={entry} />
        <EntryExamples entry={scope === 'A2' ? { ...entry, examples: entry.examples.filter(example => example.level === 'A2') } : entry}
          level={scope === 'A1' ? 'A1' : 'A2'} />
      </li>)}
    </ul>
    {entries.length > pageSize && <div className="actions">
      <button className="button secondary" type="button" disabled={!page} onClick={() => setPage(page - 1)}>السابق</button>
      <button className="button secondary" type="button" disabled={(page + 1) * pageSize >= entries.length}
        onClick={() => setPage(page + 1)}>التالي</button>
    </div>}
  </section>
}

export function QuizApp({ bank, fileControls, legacy = false, pack, explanations, feedback }: { bank: PersonalQuiz; fileControls?: ReactNode; legacy?: boolean; pack?: StudyPack|null; explanations?: ExplanationSupplement; feedback?: QuestionFeedback[] }) {
  const [settings, setSettings] = useState<QuizSettings>(() => ({...loadQuizSettings(readLocal('quiz-settings'), bank.automaticAvailable), reliability: 'with-automatic' as const}))
  const {attempt,setAttempt,loading:sessionLoading,issue:sessionIssue,historical} = useLegacySession(bank)
  const questionDetails = useMemo(()=>{
    if(!legacy)return null
    const content=buildLearningLibrary(bank,pack??null,true,explanations,feedback)
    return {content,index:analyticsQuestionIndex(content)}
  },[legacy,bank,pack,explanations,feedback])
  const questionInfo = attempt&&questionDetails?legacyQuestionInfo(attempt.questions[attempt.index],questionDetails.index):null
  const detail = questionInfo&&questionDetails?questionDetails.content.byId.get(questionInfo.id)?.view:undefined
  const route = useSyncExternalStore(subscribeScreen, readScreen, () => 'home' as const)
  let screen = route
  if (screen !== 'home' && screen !== 'vocabulary' && !attempt) screen = 'home'
  if (attempt && screen !== 'home' && screen !== 'vocabulary') {
    if (!attempt.finished) screen = 'quiz'
    else if (screen === 'quiz' || (screen === 'review' && !incorrectAnswers(attempt).length)) screen = 'results'
  }

  useEffect(() => {
    writeLocal('quiz-settings', JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    window.scrollTo(0, 0)
    if (screen === 'results' || screen === 'review' || screen === 'vocabulary') {
      document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true })
    }
  }, [screen])

  function start() {
    const questions = makeQuiz(selectedPersonalCatalog(bank, settings), Math.random, settings.count)
    if (!questions.length) {
      navigate('home')
      return
    }
    setAttempt(newAttempt(questions, 'random', settings.level, settings.count, settings.reliability))
    navigate('quiz')
  }

  function retry() {
    if (!attempt) return
    const questions = retryQuiz(attempt)
    if (!questions.length) return
    setAttempt(newAttempt(questions, 'retry', attempt.level, attempt.requestedCount, attempt.reliability))
    navigate('quiz')
  }

  function advance() {
    if (!attempt) return
    const updated = nextQuestion(attempt)
    setAttempt(updated)
    if (updated.finished) navigate('results')
  }

  const preferences = screen === 'vocabulary' ? loadPracticePreferences(readLocal('practice-preferences'), readLocal('quiz-settings')) : null
  if (legacy && sessionLoading) return <main className="site-container main-content" id="legacy-main"><p role="status">جارٍ فتح جلسة الاختبار المحفوظة…</p></main>
  if (legacy && screen === 'home') return <main className="site-container main-content" id="legacy-main">
    <section className="panel practice-empty"><h1>جلسات المفردات المحفوظة</h1><p role="status">{sessionIssue || 'لا توجد جلسة مفردات قابلة للاستئناف.'}</p><a className="button primary" href="#/progress">عرض الجلسات والنتائج السابقة</a><a className="button secondary" href="#/">افتح التدريب</a></section>
  </main>
  return (
    <main className={'site-container main-content screen-' + screen} id={legacy ? 'legacy-main' : undefined}>
      {sessionIssue && <p role="alert">{sessionIssue}</p>}
      {historical && <p role="status">هذه جلسة محفوظة بمحتواها ومفتاح تصحيحها الأصليين، وقد يختلف محتواها عن الحزمة الحالية.</p>}
      {screen === 'home' && <>
        <Home bank={bank} attempt={attempt} settings={settings} updateSettings={setSettings} start={start} />
        {fileControls}
      </>}
      {screen === 'quiz' && attempt &&
        <QuizPanel attempt={attempt} concise={legacy} detail={detail} select={id => setAttempt(current => current && answer(current, id))} advance={advance} />}
      {screen === 'results' && attempt && <Results attempt={attempt} start={legacy ? () => navigate('setup') : start} retry={retry} />}
      {screen === 'review' && attempt && <Review attempt={attempt} retry={retry} />}
      {preferences && <VocabularyReview bank={bank} scope={preferences.scope} reliability="with-automatic" />}
    </main>
  )
}

export default function App() {
  const screen = useSyncExternalStore(subscribeScreen, readScreen, () => 'home' as const)
  const [theme, setTheme] = useState(loadTheme)
  const [library, setLibrary] = useState<{bank: PersonalQuiz | null; pack: StudyPack | null; storageIssue: boolean; explanations?:ExplanationSupplement; feedback?:QuestionFeedback[]}>(() =>
    ({ bank: null, pack: null, storageIssue: false }))
  const { bank, pack, storageIssue } = library
  const [loading, setLoading] = useState(true)
  const [importStatus, setImportStatus] = useState<ImportStatus>({ kind: 'idle' })
  const importInProgress = useRef(false)
  const applyUpdate = useAppUpdate()
  const [importOpen,setImportOpen]=useState(false)
  const importDialog=useRef<HTMLDialogElement>(null)
  const lastScreen=useRef(screen)
  useEffect(()=>{if(screen==='settings'){setImportOpen(true);navigate('home')}else if(lastScreen.current!==screen&&lastScreen.current!=='settings')setImportOpen(false);lastScreen.current=screen},[screen])
  useEffect(()=>{const d=importDialog.current;if(importOpen&&!d?.open)d?.showModal();if(!importOpen&&d?.open)d.close()},[importOpen])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    writeLocal('theme', theme)
  }, [theme])

  useEffect(() => {
    let active = true
    async function load() {
      const saved = await loadEducationLibrary().catch(() => ({ vocabulary: null, study: null, storageIssue: true }))
      if (!active) return
      const restored = saved.vocabulary ? await preparePersonalQuiz(saved.vocabulary).catch(() => null) : null
      if (active) {
        setLibrary({ bank: restored, pack: saved.study, storageIssue: saved.storageIssue || Boolean(saved.vocabulary && !restored), explanations:'explanations'in saved?saved.explanations:undefined, feedback:'feedback'in saved?saved.feedback:undefined })
        setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [])

  async function importFile(file: File) {
    if (loading || importInProgress.current) return
    importInProgress.current = true
    const stage = async (value: Extract<ImportStatus, { kind: 'busy' }>['stage']) => {
      setImportStatus({ kind: 'busy', stage: value })
      // Give the browser a frame before running synchronous JSON and catalog checks.
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    try {
      await stage('reading')
      const value = await readEducationFile(file)
      await stage('validating')
      const content = validateEducationPackage(value)
      await stage('preparing')
      const nextBank = await preparePersonalQuiz(content.vocabulary)
      if(content.feedback) {
        try { validateQuestionFeedback(content.feedback, nextBank, content.study) }
        catch (cause) { throw new ImportProblem('study', 'Question feedback mismatch', undefined, undefined, {cause}) }
      }
      await stage('saving')
      const changed = await saveEducationPackage(content)
      setLibrary({ bank: nextBank, pack: content.study, storageIssue: false,explanations:content.explanations,feedback:content.feedback })
      setImportStatus({ kind: 'success', duplicate: !changed })
    } catch (error) {
      setImportStatus({ kind: 'error', message: educationImportMessage(error) })
    } finally {
      importInProgress.current = false
    }
  }
  const importControls = <EducationImport entries={bank?.dataset.entries.length ?? null} chapters={pack?.chapters.length ?? null}
    activities={pack?.questions.length ?? null} loading={loading} storageIssue={storageIssue} status={importStatus} onImport={importFile} />
  const legacy = screen === 'quiz' || screen === 'results' || screen === 'review' || screen === 'vocabulary'
  const modern=['home','setup','mistakes','questions','test','test-results','test-review','settings','analytics'].includes(screen)

  return (
    <div className="app-shell simple-shell">
      <button type="button" className="skip-link" onClick={() => {
        const main = document.querySelector<HTMLElement>('main:not([hidden]) h1, main:not([hidden]) h2')
        main?.setAttribute('tabindex', '-1')
        main?.focus()
      }}>انتقل إلى المحتوى</button>
      <header className="site-header unified-header">
        <div className="site-container header-inner">
          <a href="#/" className="brand" aria-label="German Quiz، الرئيسية">
            <span className="brand-mark"><Icon name="book" size={22} /></span>
            <span><strong lang="en" dir="ltr">German Quiz</strong><small>تعلّم الألمانية</small></span>
          </a>
          <div className="header-tools"><button className="import-shortcut" onClick={()=>setImportOpen(true)} aria-label="استيراد المحتوى التعليمي"><Icon name="layers" size={18}/><span>ملف المحتوى</span></button>
          <button className="theme-button" aria-label={theme==='light'?'تفعيل الوضع الداكن':'تفعيل الوضع الفاتح'} onClick={()=>setTheme(theme==='light'?'dark':'light')}><Icon name={theme==='light'?'moon':'sun'}/></button></div>
        </div>
      </header>
      {applyUpdate && <aside className="site-container app-update" aria-label="تحديث التطبيق">
        <button type="button" className="button secondary" onClick={applyUpdate}>تثبيت تحديث التطبيق</button>
      </aside>}
      {modern?<SimpleLearning screen={screen==='settings'?'home':screen as SimpleScreen} navigate={navigate} bank={bank} pack={pack} loading={loading} openImport={()=>setImportOpen(true)} supplement={library.explanations} feedback={library.feedback}/>:
        !legacy&&<UnifiedPractice screen={screen==='legacy-setup'?'setup':screen as PracticeScreen} navigate={s=>navigate(s==='setup'?'legacy-setup':s)} bank={bank} pack={pack} contentLoading={loading} importControls={importControls} theme={theme} changeTheme={setTheme}/>}
      <dialog ref={importDialog} className="content-dialog" aria-label="ملف المحتوى الخاص" onCancel={()=>setImportOpen(false)} onClose={()=>setImportOpen(false)}>{importOpen&&<><div className="dialog-heading"><h2>ملف المحتوى الخاص</h2><button className="theme-button" onClick={()=>setImportOpen(false)} aria-label="إغلاق"><Icon name="cross"/></button></div><LearningDataTools bank={bank} pack={pack} importControls={importControls}/></>}</dialog>
      {legacy && (bank ? <QuizApp key={bank.revision} bank={bank} pack={pack} explanations={library.explanations} feedback={library.feedback} legacy /> :
        <main className="site-container main-content">
          {loading ? <p role="status">جارٍ فتح مكتبة المفردات…</p> : <section className="panel practice-empty">
            <h1>استورد ملف المحتوى لفتح القاموس والاختبارات المحفوظة</h1>
            <a className="button primary" href="#/settings">فتح إعدادات المحتوى</a>
          </section>}
        </main>)}
      <footer className="site-container site-footer">
        <span>German Quiz</span>
        <bdi lang="de" dir="ltr">A1+ / A2+</bdi>
      </footer>
    </div>
  )
}
