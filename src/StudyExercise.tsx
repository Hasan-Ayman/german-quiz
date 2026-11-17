import { useState, type FormEvent } from 'react'
import { checkStudyAnswer, shuffled } from './study-engine'
import type { StudyQuestion } from './study-content'

const number = new Intl.NumberFormat('ar-u-nu-arab')
export type StudyResult = 'correct' | 'incorrect' | 'known' | 'missed' | 'completed'

function LocalText({ text, lang = 'de' }: { text: string; lang?: 'de' | 'ar' }) {
  return <bdi lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>{text}</bdi>
}

function Question({ item, next, onResult }: {
  item: StudyQuestion; next: () => void; onResult: (result: StudyResult) => void
}) {
  const [response, setResponse] = useState('')
  const [marked, setMarked] = useState<StudyResult | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [typed, setTyped] = useState(!item.choices)
  const [choices] = useState(() => shuffled(item.choices ?? []))
  const answerLanguage = item.answerLanguage ?? (item.type === 'reading' || item.type === 'flashcard' ? 'ar' : 'de')

  function mark(result: StudyResult) {
    setMarked(result)
    onResult(result)
  }

  function grade(value: string) {
    setResponse(value)
    mark(checkStudyAnswer(item, value) ? 'correct' : 'incorrect')
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (response.trim()) grade(response)
  }

  return <section className="panel study-flow" aria-label="نشاط الدراسة">
    <h2>{item.instruction}</h2>
    {item.prompt && <p className="study-prompt"><LocalText text={item.prompt} lang={item.promptLanguage} /></p>}
    {!marked && (item.type === 'flashcard'
      ? revealed ? <><p><LocalText text={item.answers.join(' / ')} lang={answerLanguage} /></p>
        <div className="study-actions"><button className="button primary" onClick={() => mark('known')}>أعرفها</button>
          <button className="button secondary" onClick={() => mark('missed')}>أحتاج إلى مراجعتها</button></div></>
        : <button className="button secondary" onClick={() => setRevealed(true)}>اقلب البطاقة</button>
      : <>
        {item.choices && <button className="button secondary" onClick={() => setTyped(value => !value)}>
          {typed ? 'إظهار الخيارات' : 'كتابة الإجابة'}
        </button>}
        {typed ? <form className="study-flow" onSubmit={submit}>
          <label htmlFor="study-answer">إجابتك</label>
          <input id="study-answer" type="text" lang={answerLanguage} dir={answerLanguage === 'de' ? 'ltr' : 'rtl'}
            autoComplete="off" spellCheck={false} value={response} onChange={event => setResponse(event.target.value)} />
          <button className="button primary" disabled={!response.trim()}>تحقق من الإجابة</button>
        </form> : <div className="study-flow">{choices.map(choice => <button type="button" key={choice}
          className="button secondary" onClick={() => grade(choice)}><LocalText text={choice} lang={answerLanguage} /></button>)}</div>}
      </>)}
    {marked && <div className="study-flow study-feedback" role="status">
      <strong>{marked === 'correct' ? 'إجابة صحيحة' : marked === 'incorrect' ? 'إجابة غير صحيحة'
        : marked === 'known' ? 'بطاقة معروفة' : marked === 'missed' ? 'بطاقة للمراجعة' : 'اكتمل النشاط'}</strong>
      {response && <p>إجابتك: <LocalText text={response} lang={answerLanguage} /></p>}
      <p>الإجابة: <LocalText text={item.answers.join(' / ')} lang={answerLanguage} /></p>
      <p lang="ar" dir="rtl">{item.explanation}</p>
      <p lang="de" dir="ltr">{item.german}</p>
      <p lang="ar" dir="rtl">{item.arabic}</p>
      <p className="study-source">المصدر <bdi dir="ltr">{item.source.document}</bdi> · صفحة PDF {number.format(item.source.page)}</p>
      <button type="button" className="button primary" onClick={next}>النشاط التالي</button>
    </div>}
  </section>
}

export function StudyExercise({ items, close, onResult }: {
  items: StudyQuestion[]; close: () => void; onResult?: (question: StudyQuestion, result: StudyResult) => void
}) {
  const [index, setIndex] = useState(0)
  const [results, setResults] = useState<StudyResult[]>([])
  const item = items[index]
  const scored = results.filter(result => result === 'correct' || result === 'incorrect')
  return <div className="study-flow">
    <div className="study-title">
      <p>النشاط {number.format(Math.min(index + 1, items.length))} من {number.format(items.length)}</p>
      <button className="button secondary" type="button" onClick={close}>العودة إلى الإعدادات</button>
    </div>
    {item ? <Question key={item.id} item={item} next={() => setIndex(value => value + 1)} onResult={result => {
      setResults(values => [...values, result])
      onResult?.(item, result)
    }} /> : <section className="panel study-flow">
      <h2>انتهى التدريب</h2>
      <p>الأنشطة المنجزة: {number.format(results.length)}.</p>
      {scored.length > 0 && <p>الإجابات الصحيحة: {number.format(scored.filter(result => result === 'correct').length)} من {number.format(scored.length)}.</p>}
      {results.some(result => result === 'known' || result === 'missed') && <p>البطاقات المعروفة: {number.format(results.filter(result => result === 'known').length)}.</p>}
    </section>}
  </div>
}
