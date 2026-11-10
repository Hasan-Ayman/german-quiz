import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { Icon } from './icons'
import { readPersonalFile, validatePersonalDataset } from './personal-data'
import { preparePersonalQuiz, selectedPersonalCatalog, type PersonalQuiz } from './personal-quiz'
import { loadPersonalDataset, savePersonalDataset } from './personal-storage'
import { useAppUpdate } from './pwa'
import { VocabularyFile } from './VocabularyFile'
import { isLevel, isReliability, levels, preferredExample, type ExampleSentence, type Level, type PilotEntry } from './pilot'
import {
  answer, buildCatalog, incorrectAnswers, isCorrect, isQuestionCount, makeQuiz, modes, newAttempt,
  nextQuestion, questionCounts, retryQuiz, type Attempt, type Mode, type Text,
} from './quiz'
import { loadAttempt, loadQuizSettings, loadTheme, readLocal, saveAttempt, writeLocal, type QuizSettings } from './storage'

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

type Screen = 'home' | 'quiz' | 'results' | 'review'

function readScreen(): Screen {
  const name = window.location.hash.slice(2)
  return name === 'quiz' || name === 'results' || name === 'review' ? name : 'home'
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
  const info = modeInfo[mode]
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
          {example.localApproval && ' · معتمد آليًا للاستخدام المحلي'}</span>
      </div>
      <p lang="de" dir="ltr">{example.german}</p>
      {example.origin === 'source_pdf' && example.arabicOrigin === 'authored' &&
        <small>ترجمة عربية مضافة{example.arabicLocalApproval && ' · معتمدة آليًا للاستخدام المحلي'}</small>}
      {example.arabic && <p lang="ar" dir="rtl">{example.arabic}</p>}
    </section>
  )
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
  const eligibleCount = selectedPersonalCatalog(bank, settings).entryCount
  const expanded = bank.automaticAvailable
  const availableCount = Math.min(settings.count, eligibleCount)
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
                if (isLevel(level)) updateSettings({ ...settings, level })
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
            {expanded && <label className="reliability-setting">
              موثوقية المفردات
              <select value={settings.reliability} aria-describedby="reliability-description" onChange={event => {
                const reliability = event.target.value
                if (isReliability(reliability)) updateSettings({ ...settings, reliability })
              }}>
                <option value="reviewed">المفردات المراجَعة فقط</option>
                <option value="with-automatic">المراجَعة والمفردات التي اجتازت الفحص الآلي</option>
              </select>
            </label>}
          </div>
          {expanded && <p className="notice" id="reliability-description">
            مجموعة الفحص الآلي مخصّصة للاختبار المحلي. لم يراجع شخصٌ جميع مفرداتها واحدةً تلو الأخرى.
          </p>}
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
          <span><Icon name="shuffle" size={17} /> {number(modes.length)} أنواع من الأسئلة</span>
          <span><Icon name="retry" size={17} /> إعادة المحاولة للأخطاء</span>
        </div>
      </section>
      <section className="modes" aria-labelledby="modes-title">
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
      </section>
    </>
  )
}

export function QuizPanel({ attempt, select, advance }: {
  attempt: Attempt
  select: (id: string) => void
  advance: () => void
}) {
  const current = attempt.questions[attempt.index]
  const total = attempt.questions.length
  const selected = attempt.answers[attempt.index]
  const example = selected && preferredExample(current.entry.examples, attempt.level)
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
          <ModeLabel mode={current.mode} />
          <p className="question-instruction">{modeInfo[current.mode].instruction}</p>
          <h1 tabIndex={-1} ref={heading}><LanguageText {...current.prompt} /></h1>
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
              <VocabularyDetail entry={current.entry} />
              {example && <ExampleFeedback example={example} />}
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
            {detailed && <VocabularyDetail entry={question.entry} />}
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

export function QuizApp({ bank, fileControls }: { bank: PersonalQuiz; fileControls?: ReactNode }) {
  const [settings, setSettings] = useState(() => loadQuizSettings(readLocal('quiz-settings'), bank.automaticAvailable))
  const [attempt, setAttempt] = useState(() => loadAttempt(readLocal('attempt'), bank.catalogs, bank.revision,
    bank.automaticAvailable ? { getCatalog: bank.getExpandedCatalog, revision: bank.revision } : undefined))
  const route = useSyncExternalStore(subscribeScreen, readScreen, () => 'home' as const)
  let screen = route
  if (screen !== 'home' && !attempt) screen = 'home'
  if (attempt && screen !== 'home') {
    if (!attempt.finished) screen = 'quiz'
    else if (screen === 'quiz' || (screen === 'review' && !incorrectAnswers(attempt).length)) screen = 'results'
  }

  useEffect(() => {
    if (attempt) writeLocal('attempt', saveAttempt(attempt, bank.revision))
  }, [attempt, bank.revision])

  useEffect(() => {
    writeLocal('quiz-settings', JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    window.scrollTo(0, 0)
    if (screen === 'results' || screen === 'review') {
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

  return (
    <main className={'site-container main-content screen-' + screen}>
      {screen === 'home' && <>
        <Home bank={bank} attempt={attempt} settings={settings} updateSettings={setSettings} start={start} />
        {fileControls}
      </>}
      {screen === 'quiz' && attempt &&
        <QuizPanel attempt={attempt} select={id => setAttempt(current => current && answer(current, id))} advance={advance} />}
      {screen === 'results' && attempt && <Results attempt={attempt} start={start} retry={retry} />}
      {screen === 'review' && attempt && <Review attempt={attempt} retry={retry} />}
    </main>
  )
}

export default function App() {
  const [theme, setTheme] = useState(loadTheme)
  const [bank, setBank] = useState<PersonalQuiz | null>(null)
  const [loading, setLoading] = useState(true)
  const [storageFailed, setStorageFailed] = useState(false)
  const [importSequence, setImportSequence] = useState(0)
  const applyUpdate = useAppUpdate()

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    writeLocal('theme', theme)
  }, [theme])

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const saved = await loadPersonalDataset()
        if (saved && active) {
          const restored = await preparePersonalQuiz(validatePersonalDataset(saved))
          if (active) setBank(restored)
        }
      } catch {
        if (active) setStorageFailed(true)
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [])

  async function importFile(file: File) {
    const dataset = await readPersonalFile(file)
    const nextBank = await preparePersonalQuiz(dataset)
    await savePersonalDataset(dataset)
    setStorageFailed(false)
    setBank(nextBank)
    setImportSequence(value => value + 1)
    navigate('home')
  }
  const fileControls = <VocabularyFile bank={bank} onImport={importFile} storageFailed={storageFailed} />
  const themeLabel = theme === 'light' ? 'تفعيل الوضع الداكن' : 'تفعيل الوضع الفاتح'

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="site-container header-inner">
          <a href="#/" className="brand" aria-label="مفردات، الصفحة الرئيسية">
            <span className="brand-mark"><Icon name="book" size={23} /></span>
            <span><strong>مفردات</strong><small lang="de" dir="ltr">DEUTSCH QUIZ</small></span>
          </a>
          <button className="theme-button" type="button" onClick={() => setTheme(value => value === 'light' ? 'dark' : 'light')}
            aria-label={themeLabel} title={themeLabel}>
            <Icon name={theme === 'light' ? 'moon' : 'sun'} size={21} />
          </button>
        </div>
      </header>
      {applyUpdate && <aside className="site-container app-update" aria-label="تحديث التطبيق">
        <button type="button" className="button secondary" onClick={applyUpdate}>تثبيت تحديث التطبيق</button>
      </aside>}
      {bank ? <QuizApp key={importSequence} bank={bank} fileControls={fileControls} />
        : <main className="site-container main-content screen-home">
          {loading ? <p role="status">جارٍ فتح مكتبة المفردات…</p> : fileControls}
        </main>}
      <footer className="site-container site-footer">
        <span>مفردات · تدريب الألمانية</span>
        <bdi lang="de" dir="ltr">A1 / A2</bdi>
      </footer>
    </div>
  )
}
