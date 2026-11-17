import { useRef, useState, type ChangeEvent } from 'react'
import { serializePersonalDataset, type PersonalDataset } from './personal-data'
import type { PersonalQuiz } from './personal-quiz'
import { importMessage } from './import-problem.ts'

export function VocabularyFile({ bank, onImport, storageFailed }: {
  bank: PersonalQuiz | null
  onImport: (file: File) => Promise<void>
  storageFailed: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const format = new Intl.NumberFormat('ar-u-nu-arab')

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    setBusy(true)
    setFailure(null)
    try {
      await onImport(file)
    } catch (error) {
      setFailure(importMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel vocabulary-file" aria-labelledby="vocabulary-title">
      {bank ? <h2 id="vocabulary-title">ملف المفردات الشخصي</h2>
        : <h2 id="vocabulary-title">ابدأ باستيراد مفرداتك</h2>}
      <p>{bank ? 'يمكنك تنزيل نسخة من مفرداتك ونقلها يدويًا إلى جهاز آخر.'
        : 'اختر ملف المفردات الشخصي بصيغة JSON لبدء التدريب. يُحفظ الملف داخل هذا المتصفح.'}</p>
      {bank && <p className="notice">
        المفردات جاهزة · {format.format(bank.dataset.entries.length)} مفردة مستوردة
        {' · '}<bdi dir="ltr">A1</bdi> {format.format(bank.importedCounts.A1)}
        {' · '}<bdi dir="ltr">A2</bdi> {format.format(bank.importedCounts.A2)}
        {' · '}قد تنتمي المفردة إلى المستويين.
      </p>}
      <input ref={input} type="file" accept=".json,application/json" hidden onChange={choose} />
      <div className="actions">
        <button type="button" className={'button ' + (bank ? 'secondary' : 'primary')}
          disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'جارٍ فحص الملف…' : bank ? 'استبدال ملف المفردات' : 'اختر ملف المفردات'}
        </button>
        {bank && <button type="button" className="button secondary" disabled={busy}
          onClick={() => downloadDataset(bank.dataset)}>تنزيل ملف المفردات</button>}
      </div>
      {storageFailed && <p role="alert">تعذّر فتح مساحة التخزين على هذا الجهاز. تحقّق من إعدادات المتصفح وحاول مجددًا.</p>}
      {failure && <p role="alert">{failure}{bank && ' مفرداتك الحالية ما زالت محفوظة.'}</p>}
    </section>
  )
}

function downloadDataset(dataset: PersonalDataset) {
  const url = URL.createObjectURL(new Blob([serializePersonalDataset(dataset)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'german-quiz-personal-vocabulary-v' + dataset.version + '.json'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
