import { useState, type FormEvent } from 'react'
import { checkStudyAnswer, shuffled } from './study-engine'
import type { StudyQuestion } from './study-content'
import { StudySpeech } from './StudySpeech'

const number = new Intl.NumberFormat('ar-u-nu-arab')
import type { StudyResult } from './study-progress'

function LocalText({ text, lang = 'de' }: { text: string; lang?: 'de' | 'ar' }) {
  return <bdi lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>{text}</bdi>
}

function Question({ item, next, onResult }: {
  item: StudyQuestion; next: () => void; onResult: (result: StudyResult) => void
}) {
  const [response, setResponse] = useState('')
  const [marked, setMarked] = useState<StudyResult | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [typed, setTyped] = useState(!item.choices && !item.tokens)
  const [foundError, setFoundError] = useState(item.errorIndex === undefined)
  const [locationAttempt, setLocationAttempt] = useState(false)
  const [tokens] = useState(() => shuffled((item.tokens ?? []).map((text, i) => ({ text, i }))))
  const [ordered, setOrdered] = useState<number[]>([])
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

  if (item.type === 'writing') {
    return <section className="panel study-flow" aria-label="التعبير الكتابي">
      <h2>{item.instruction}</h2>
      <label htmlFor="study-writing">اكتب بالألمانية</label>
      <textarea id="study-writing" rows={5} lang="de" dir="ltr" spellCheck={false}
        value={response} onChange={event => setResponse(event.target.value)} />
      <details>
        <summary>نموذج للمقارنة</summary>
        <p lang="de" dir="ltr">{item.model}</p>
        <p lang="ar" dir="rtl">{item.passageArabic}</p>
        <p>قارن إجابتك بالنموذج. راجع ترتيب الكلمات، وتصريف الفعل، وكتابة الأسماء بحروف كبيرة.</p>
      </details>
      <p className="study-source">التقييم ذاتي في هذا النشاط.</p>
      {marked ? <button type="button" className="button primary" onClick={next}>النشاط التالي</button>
        : <button type="button" className="button primary" disabled={!response.trim()} onClick={() => mark('completed')}>تمّت المراجعة الذاتية</button>}
    </section>
  }

  return <section className="panel study-flow" aria-label="نشاط الدراسة">
    <h2>{item.instruction}</h2>
    {!foundError && !marked ? <div className="study-flow">
      <p>حدّد الكلمة التي تحتاج إلى تصحيح.</p>
      <div className="study-word-bank" lang="de" dir="ltr">{[...item.prompt.matchAll(/\S+/gu)].map(word =>
        <button className="button secondary" type="button" key={word.index} onClick={() => {
          setLocationAttempt(true)
          setFoundError(word.index <= item.errorIndex! && item.errorIndex! < word.index + word[0].length)
        }}>{word[0]}</button>)}</div>
      {locationAttempt && <p role="status">راجع القاعدة وحاول تحديد الكلمة مرة أخرى.</p>}
      <button type="button" className="button secondary" onClick={() => setFoundError(true)}>الانتقال إلى التصحيح</button>
    </div> : item.prompt && <p className="study-prompt"><LocalText text={item.prompt} lang={item.promptLanguage} /></p>}
    {!marked && foundError && (item.type === 'flashcard'
      ? revealed ? <><p><LocalText text={item.answers.join(' / ')} lang={answerLanguage} /></p>
        <div className="study-actions"><button className="button primary" onClick={() => mark('known')}>أعرفها</button>
          <button className="button secondary" onClick={() => mark('missed')}>أحتاج إلى مراجعتها</button></div></>
        : <button className="button secondary" onClick={() => setRevealed(true)}>اقلب البطاقة</button>
      : <>
        {(item.choices || item.tokens) && <button className="button secondary" onClick={() => setTyped(value => !value)}>
          {typed ? 'إظهار الخيارات' : 'كتابة الإجابة'}
        </button>}
        {typed ? <form className="study-flow" onSubmit={submit}>
          <label htmlFor="study-answer">إجابتك</label>
          <input id="study-answer" type="text" lang={answerLanguage} dir={answerLanguage === 'de' ? 'ltr' : 'rtl'}
            autoComplete="off" spellCheck={false} value={response} onChange={event => setResponse(event.target.value)} />
          <button className="button primary" disabled={!response.trim()}>تحقق من الإجابة</button>
        </form> : item.tokens ? <div className="study-flow">
          <div className="study-word-bank" dir="ltr" lang="de" aria-label="الترتيب المختار">
            {ordered.map((index, position) => <button key={index} className="button secondary"
              onClick={() => setOrdered(items => items.filter((_, i) => i !== position))}>{item.tokens![index]}</button>)}
          </div>
          <div className="study-word-bank" dir="ltr" lang="de" aria-label="المجموعات المتاحة">
            {tokens.filter(token => !ordered.includes(token.i)).map(token => <button key={token.i} className="button secondary"
              onClick={() => setOrdered(items => [...items, token.i])}>{token.text}</button>)}
          </div>
          <button type="button" className="button primary" disabled={ordered.length !== item.tokens.length}
            onClick={() => grade(ordered.map(index => item.tokens![index]).join(' '))}>تحقق من الإجابة</button>
        </div> : <div className="study-flow">{choices.map(choice => <button type="button" key={choice}
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
      {item.type === 'reading' && item.passageArabic && <details><summary>ترجمة النص</summary>
        <p lang="ar" dir="rtl">{item.passageArabic}</p></details>}
      {item.type === 'reading' && <StudySpeech german={item.prompt} />}
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
