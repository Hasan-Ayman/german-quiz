import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Icon } from './icons'
import { studyTypeLabels } from './study-labels'
import { checkStudyAnswer, shuffled } from './study-engine'
import type { StudyQuestion } from './study-content'
import { StudySpeech } from './StudySpeech'
import { MatchingBoard, OrderBoard } from './ExerciseTools'
import { presentPronouns } from './question-types'

import type { StudyResult } from './study-progress'
import { initialPosition, type PracticePosition } from './practice-session'

const number = new Intl.NumberFormat('ar-u-nu-arab')

function LocalText({ text, lang = 'de' }: { text: string; lang?: 'de' | 'ar' }) {
  return <bdi lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>{text}</bdi>
}

function Question({ item, next, onResult, onRule, savedResult, savedResponse }: {
  item: StudyQuestion; next: () => void; onResult: (result: StudyResult, response: string) => void; onRule?: () => void
  savedResult?: StudyResult; savedResponse: string
}) {
  const [response, setResponse] = useState(savedResponse)
  const [marked, setMarked] = useState<StudyResult | null>(savedResult ?? null)
  const feedback = useRef<HTMLElement>(null)
  useEffect(() => { if (marked) feedback.current?.focus({ preventScroll: true }) }, [marked])
  const [revealed, setRevealed] = useState(false)
  const [typed, setTyped] = useState(item.support === 'recall' && !['reading', 'order'].includes(item.type) || !item.choices && !item.tokens)
  const [foundError, setFoundError] = useState(item.errorIndex === undefined)
  const [locationAttempt, setLocationAttempt] = useState(false)
  const [choices] = useState(() => {
    const supplied = shuffled(item.choices ?? [])
    if (item.support !== 'guided' || supplied.length < 4) return supplied
    const distractor = supplied.find(value => !checkStudyAnswer(item, value))
    return supplied.filter(value => value !== distractor)
  })
  const answerLanguage = item.answerLanguage ?? (item.type === 'reading' || item.type === 'flashcard' ? 'ar' : 'de')
  const incorrect = marked === 'incorrect' || marked === 'missed'
  const exercise = item.activity ?? item.type
  const locked = useRef(Boolean(savedResult))

  function mark(result: StudyResult, value = response) {
    if (locked.current) return
    locked.current = true
    setMarked(result)
    onResult(result, value)
  }
  function grade(value: string) {
    setResponse(value)
    mark(checkStudyAnswer(item, value) ? 'correct' : 'incorrect', value)
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    if (response.trim()) grade(response)
  }

  return <section className={'panel study-flow learning-exercise exercise-' + exercise} aria-label="نشاط الدراسة">
    <h1 tabIndex={-1}>{item.instruction}</h1>
    <div className={item.type === 'reading' ? 'reading-spread' : 'study-flow'}>
      {item.type === 'reading' && <article className="reading-paper" aria-label="نص القراءة">
        <p lang="de" dir="ltr" className="study-prompt">{item.prompt}</p>
        <StudySpeech german={item.prompt} />
      </article>}
      <div className="study-flow exercise-body">
        {!foundError && !marked ? <div className="study-flow">
          <p>حدّد الكلمة التي تحتاج إلى تصحيح.</p>
          <div className="study-word-bank" lang="de" dir="ltr">{[...item.prompt.matchAll(/\S+/gu)].map(word =>
            <button className="button secondary" type="button" key={word.index} onClick={() => {
              setLocationAttempt(true)
              setFoundError(word.index <= item.errorIndex! && item.errorIndex! < word.index + word[0].length)
            }}>{word[0]}</button>)}</div>
          {locationAttempt && <p role="status">حاول تحديد موضع الخطأ مرة أخرى.</p>}
          <button type="button" className="button secondary" onClick={() => setFoundError(true)}>الانتقال إلى التصحيح</button>
        </div> : item.prompt && !['reading', 'matching', 'flashcard'].includes(item.type) && <Prompt item={item} />}
        {item.hint && <p className="study-source"><LocalText text={item.hint.text} lang={item.hint.lang} /></p>}
        {!marked && foundError && (item.type === 'flashcard'
          ? <div className="flip-study-card">
            <div className="flip-card-face" aria-live="polite">
              <span>{revealed ? 'ظهر البطاقة' : 'وجه البطاقة'}</span>
              <strong><LocalText text={revealed ? item.answers.join(' / ') : item.prompt}
                lang={revealed ? answerLanguage : item.promptLanguage} /></strong>
            </div>
            {revealed ? <div className="study-actions">
              <button type="button" className="button primary" onClick={() => mark('known')}>أعرفها</button>
              <button type="button" className="button secondary" onClick={() => mark('missed')}>أحتاج إلى مراجعتها</button>
            </div> : <button type="button" className="button secondary" onClick={() => setRevealed(true)}>اقلب البطاقة</button>}
          </div> : item.pairs ? <MatchingBoard pairs={item.pairs} submit={grade} /> : <>
            {(item.choices || item.tokens) && <button className="text-button" type="button" onClick={() => setTyped(value => !value)}>
              {typed ? 'إظهار الخيارات' : 'كتابة الإجابة'}
            </button>}
            {typed ? <form className="study-flow short-answer" onSubmit={submit}>
              <label htmlFor="study-answer">إجابتك</label>
              <input id="study-answer" type="text" lang={answerLanguage} dir={answerLanguage === 'de' ? 'ltr' : 'rtl'}
                autoComplete="off" spellCheck={false} maxLength={1000} value={response} onChange={event => setResponse(event.target.value)} />
              <button className="button primary" disabled={!response.trim()}>تحقق من الإجابة</button>
            </form> : item.tokens ? <OrderBoard tokens={item.tokens} submit={grade} /> :
              <AnswerChoices choices={choices} language={answerLanguage} select={grade} />}
          </>)}
        {marked && !typed && choices.length > 0 && <AnswerChoices choices={choices} language={answerLanguage}
          response={response} correct={item.answers} />}
        {marked && <div className={'study-flow study-feedback ' + (incorrect ? 'feedback-missed' : 'feedback-known')} role="status">
          <strong tabIndex={-1} ref={feedback}>{marked === 'correct' ? 'إجابة صحيحة' : marked === 'incorrect' ? 'إجابة غير صحيحة'
            : marked === 'known' ? 'بطاقة معروفة' : 'بطاقة للمراجعة'}</strong>
          {incorrect && <>
            {response && <p>إجابتك: <LocalText text={response} lang={answerLanguage} /></p>}
            {item.pairs ? <ul>{item.pairs.map(pair => <li key={pair.german}><LocalText text={pair.german} /> · {pair.arabic}</li>)}</ul> :
              <p>الإجابة: <LocalText text={item.answers.join(' / ')} lang={answerLanguage} /></p>}
            <p className="arabic-explanation" lang="ar" dir="rtl">{item.explanation || 'لا يتوفر شرح موثّق لهذا السؤال. قارن إجابتك بالإجابة المعتمدة.'}</p>
            {item.german && <p lang="de" dir="ltr">{item.german}</p>}
            {item.arabic && <p lang="ar" dir="rtl">{item.arabic}</p>}
            {Boolean(item.examples?.length) && <div className="session-examples">
              <strong>مثال في السياق</strong>
              {item.examples!.slice(0, 1).map(example => <div key={example.german}>
                <p lang="de" dir="ltr">{example.german}</p>
                {example.arabic && <p lang="ar" dir="rtl">{example.arabic}</p>}
                {example.origin === 'source_pdf' && <small className="study-source"><bdi dir="ltr">{example.sourcePdf}</bdi> · صفحة {number.format(example.page)}</small>}
              </div>)}
            </div>}
            {item.type === 'reading' && item.passageArabic && <details><summary>ترجمة النص</summary>
              <p lang="ar" dir="rtl">{item.passageArabic}</p></details>}
            <p className="study-source">المصدر <bdi dir="ltr">{item.source.document}</bdi> · صفحة PDF {number.format(item.source.page)}</p>
            <div className="study-actions">
              {item.topic && onRule && <button type="button" className="button secondary" onClick={onRule}>تدرّب على هذه القاعدة</button>}
              <a className="text-button" href={'#/mistakes?item=' + encodeURIComponent(item.id)}>افتح دفتر الأخطاء</a>
            </div>
          </>}
          <button type="button" className="button primary" onClick={next}>النشاط التالي</button>
        </div>}
      </div>
    </div>
  </section>
}

function Prompt({ item }: { item: StudyQuestion }) {
  const isVerb = item.type === 'verb'
  const [base, pronoun, ...rest] = item.prompt.split(' · ')
  if (isVerb && rest.length === 0 && presentPronouns.some(value => value === pronoun)) {
    return <dl className="verb-conjugation-grid">
      <div><dt>المصدر</dt><dd><LocalText text={base} /></dd></div>
      <div><dt>الضمير</dt><dd><LocalText text={pronoun} /></dd></div>
      <div><dt>التصريف المطلوب</dt><dd className="sentence-gap" dir="ltr">___</dd></div>
    </dl>
  }
  const hasGap = /_{2,}/u.test(item.prompt)
  return <div className={'study-prompt ' + (isVerb ? 'verb-form-sheet' : hasGap ? 'gap-sheet' : '')}
    lang={item.promptLanguage ?? 'de'} dir={item.promptLanguage === 'ar' ? 'rtl' : 'ltr'}>
    {isVerb && <small lang="ar" dir="rtl">صيغة الفعل</small>}
    <span className="prompt-content">{hasGap ? item.prompt.split(/(_{2,})/u).map((part, i) => i % 2 ? <span key={i} className="sentence-gap" aria-label="فراغ">{part}</span> : part) :
      <LocalText text={item.prompt} lang={item.promptLanguage} />}</span>
  </div>
}

function AnswerChoices({ choices, language, select, response, correct }: {
  choices: string[]; language: 'de' | 'ar'; select?: (answer: string) => void; response?: string; correct?: string[]
}) {
  return <div className="session-choice-grid" aria-label="خيارات الإجابة">
    {choices.map((choice, index) => {
      const state = correct?.includes(choice) ? ' correct-choice' : choice === response ? ' wrong-choice' : ''
      return <button type="button" key={choice} disabled={!select} onClick={() => select?.(choice)}
        className={'session-choice' + state}>
        <span className="option-index" aria-hidden="true">{number.format(index + 1)}</span>
        <LocalText text={choice} lang={language} />
        {state && <><Icon name={state === ' correct-choice' ? 'check' : 'cross'} size={19} />
          <span className="sr-only">{state === ' correct-choice' ? 'الإجابة الصحيحة' : 'اختيارك غير الصحيح'}</span></>}
      </button>
    })}
  </div>
}

export function StudyExercise({ items, close, onResult, onRule, onRetry, position = initialPosition, onPosition }: {
  items: StudyQuestion[]; close: () => void; onResult?: (question: StudyQuestion, result: StudyResult, answer: string, position: PracticePosition) => Promise<boolean>
  onRule?: (question: StudyQuestion) => void; onRetry?: (items: StudyQuestion[]) => void
  position?: PracticePosition; onPosition?: (position: PracticePosition) => void
}) {
  const [current, setCurrent] = useState(position)
  const { index, results, response } = current
  const pending = useRef<Promise<boolean> | null>(null)
  const saveAgain = useRef<(() => Promise<boolean>) | null>(null)
  const advancing = useRef(false)
  function update(value: PracticePosition) {
    setCurrent(value)
    onPosition?.(value)
  }
  const root = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const item = items[index]
  const scored = results.filter(result => result === 'correct' || result === 'incorrect')
  const correct = scored.filter(result => result === 'correct').length
  const known = results.filter(result => result === 'known').length
  const mistakes = items.filter((_, i) => results[i] === 'incorrect' || results[i] === 'missed')

  useEffect(() => {
    const heading = root.current?.querySelector<HTMLElement>('h1')
    heading?.focus({ preventScroll: true })
    window.scrollTo(0, 0)
  }, [index])

  return <div ref={root} className="session-layout study-flow">
    <div className="session-toolbar">
      <div className="session-context">
        <p className="section-label"><Icon name={item ? 'layers' : 'check'} size={17} /> {item ? studyTypeLabels[item.type] : 'ملخص الجلسة'}</p>
        {item && <span className="chapter-context"><bdi dir="ltr">{item.chapter.split(':')[0]}+</bdi> · الفصل {number.format(Number(item.chapter.split(':')[1]))}</span>}
      </div>
      <button className="button secondary" type="button" onClick={() => item ? dialog.current?.showModal() : close()}>
        {item ? 'إيقاف مؤقت' : 'العودة إلى التدريب'}</button>
    </div>
    <dialog ref={dialog} className="session-dialog" aria-labelledby="pause-title">
      <h2 id="pause-title">إيقاف التدريب مؤقتًا؟</h2>
      <p>تُحفظ إجاباتك المسجّلة. يمكنك متابعة هذه الجلسة من الصفحة الرئيسية.</p>
      <div className="study-actions">
        <button className="button primary" type="button" autoFocus onClick={() => dialog.current?.close()}>متابعة الجلسة</button>
        <button className="button secondary" type="button" onClick={() => { dialog.current?.close(); close() }}>العودة إلى التدريب</button>
      </div>
    </dialog>
    {item ? <>
      <div className="session-meter">
        <span>النشاط {number.format(index + 1)} من {number.format(items.length)}</span>
        <progress aria-label="تقدم الجلسة" max={items.length} value={results.length} />
      </div>
      <Question key={item.id} item={item} onRule={onRule ? () => onRule(item) : undefined}
        savedResult={results[index]} savedResponse={response}
        next={() => {
          if (advancing.current) return
          advancing.current = true
          void (pending.current ?? Promise.resolve(true)).then(async saved => {
            if (!saved && saveAgain.current) saved = await saveAgain.current()
            if (saved) {
              pending.current = null
              saveAgain.current = null
              update({ index: index + 1, results, response: '' })
            }
          }).finally(() => { advancing.current = false })
        }} onResult={(result, answer) => {
          const position = { index, results: [...results, result], response: answer }
          if (!onResult) { update(position); return }
          setCurrent(position)
          saveAgain.current = () => onResult(item, result, answer, position)
          pending.current = saveAgain.current()
        }} />
    </> : <section className="panel session-results study-flow">
      <span className="practice-symbol"><Icon name="check" size={25} /></span>
      <h1 tabIndex={-1}>انتهى التدريب</h1>
      <dl>
        <div><dt>الأنشطة المنجزة</dt><dd>{number.format(results.length)}</dd></div>
        {scored.length > 0 && <>
          <div><dt>الإجابات الصحيحة</dt><dd>{number.format(correct)} / {number.format(scored.length)}</dd></div>
          <div><dt>الدقّة</dt><dd>{number.format(Math.round(correct * 100 / scored.length))}٪</dd></div>
        </>}
        {results.some(result => result === 'known' || result === 'missed') && <div><dt>البطاقات المعروفة</dt><dd>{number.format(known)}</dd></div>}
      </dl>
      {mistakes.length > 0 && <details open>
        <summary>مراجعة الأخطاء · {number.format(mistakes.length)}</summary>
        <ul className="mistake-list">{mistakes.map(question => <li key={question.id}>
          <bdi dir="ltr">{question.chapter}</bdi>
          <LocalText text={question.type === 'reading' ? question.instruction : question.prompt}
            lang={question.type === 'reading' ? 'ar' : question.promptLanguage} />
          <strong><LocalText text={question.answers.join(' / ')}
            lang={question.answerLanguage ?? (question.type === 'reading' || question.type === 'flashcard' ? 'ar' : 'de')} /></strong>
        </li>)}</ul>
      </details>}
      <div className="study-actions">
        {mistakes.length > 0 && onRetry && <button className="button primary" type="button" onClick={() => onRetry(shuffled(mistakes))}>
          <Icon name="retry" size={18} /> أعد تدريب الأخطاء</button>}
        <button className={'button ' + (mistakes.length ? 'secondary' : 'primary')} type="button" onClick={close}>إعداد جلسة جديدة</button>
      </div>
    </section>}
  </div>
}
