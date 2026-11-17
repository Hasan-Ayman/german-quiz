import { useState, type DragEvent } from 'react'
import type { StudyQuestion } from './study-content'
import { shuffled, shuffledStudyTokens } from './study-engine'

export function OrderBoard({ tokens, submit }: { tokens: string[]; submit: (answer: string) => void }) {
  const [tiles] = useState(() => shuffledStudyTokens(tokens))
  const [order, setOrder] = useState<number[]>([])
  const [dragged, setDragged] = useState<number | null>(null)
  function place(tile: number, before?: number) {
    setOrder(current => {
      const next = current.filter(value => value !== tile)
      const index = before === undefined ? -1 : next.indexOf(before)
      next.splice(index < 0 ? next.length : index, 0, tile)
      return next
    })
  }
  function start(event: DragEvent, tile: number) {
    setDragged(tile)
    event.dataTransfer.setData('text/plain', String(tile))
    event.dataTransfer.effectAllowed = 'move'
  }
  function drop(event: DragEvent, before?: number) {
    event.preventDefault()
    event.stopPropagation()
    if (dragged !== null && dragged !== before) place(dragged, before)
    setDragged(null)
  }
  return <div className="study-flow">
    <p className="setup-helper">اسحب الكلمات أو اضغط عليها لإضافتها بالترتيب. اضغط الكلمة المختارة لإعادتها.</p>
    <div className="study-word-bank sentence-target" dir="ltr" lang="de" aria-label="الترتيب المختار"
      onDragOver={e => e.preventDefault()} onDrop={e => drop(e)}>
      {order.map(tile => <button className="button secondary" type="button" key={tile}
        draggable onDragStart={e => start(e, tile)} onDragEnd={() => setDragged(null)}
        onDragOver={e => e.preventDefault()} onDrop={e => drop(e, tile)}
        onClick={() => setOrder(values => values.filter(value => value !== tile))}>{tokens[tile]}</button>)}
    </div>
    <div className="study-word-bank" dir="ltr" lang="de" aria-label="المجموعات المتاحة">
      {tiles.filter(tile => !order.includes(tile.i)).map(tile => <button className="button secondary" type="button"
        key={tile.i} draggable onDragStart={e => start(e, tile.i)} onDragEnd={() => setDragged(null)}
        onClick={() => place(tile.i)}>{tile.text}</button>)}
    </div>
    <div className="study-actions">
      <button className="button primary" type="button" disabled={order.length !== tokens.length}
        onClick={() => submit(order.map(tile => tokens[tile]).join(' '))}>تحقق من الإجابة</button>
      <button className="button secondary" type="button" onClick={() => setOrder([])} disabled={!order.length}>إعادة ترتيب الكلمات</button>
    </div>
  </div>
}

export function MatchingBoard({ pairs, submit }: { pairs: NonNullable<StudyQuestion['pairs']>; submit: (answer: string) => void }) {
  const [right] = useState(() => shuffled(pairs.map((pair, index) => ({ index, label: pair.arabic }))))
  const [selected, setSelected] = useState<number | null>(null)
  const [links, setLinks] = useState<Record<number, number>>({})
  function attach(index: number) {
    if (selected === null) return
    setLinks(before => ({ ...Object.fromEntries(Object.entries(before).filter(([, value]) => value !== index)), [selected]: index }))
    setSelected(null)
  }
  return <div className="study-flow">
    <p className="setup-helper">اختر كلمة ثم معناها. يمكنك تغيير الربط قبل التحقق.</p>
    <div className="matching-board">
      <div role="group" aria-label="الكلمات الألمانية">{pairs.map((pair, i) =>
        <button type="button" key={pair.german} className="button secondary" aria-pressed={selected === i} onClick={() => setSelected(i)}>
          <bdi lang="de" dir="ltr">{pair.german}</bdi>
          {links[i] !== undefined && <small>{pairs[links[i]].arabic}</small>}
        </button>)}</div>
      <div role="group" aria-label="المعاني العربية">{right.map(item =>
        <button type="button" key={item.index} className="button secondary" disabled={selected === null}
          onClick={() => attach(item.index)}><bdi lang="ar" dir="rtl">{item.label}</bdi></button>)}</div>
    </div>
    <div className="study-actions">
      <button type="button" className="button primary" disabled={Object.keys(links).length !== pairs.length}
        onClick={() => submit(pairs.map((_, index) => pairs[links[index]].arabic).join(' | '))}>تحقق من الإجابة</button>
      <button className="button secondary" type="button" onClick={() => { setLinks({}); setSelected(null) }}>مسح الربط</button>
    </div>
  </div>
}
