import { useRef, type ChangeEvent } from 'react'

export const importStages = {
  reading: 'جارٍ قراءة الملف من جهازك…',
  validating: 'جارٍ التحقّق من المفردات والفصول والأنشطة…',
  preparing: 'جارٍ تجهيز محتوى التدريب…',
  saving: 'جارٍ حفظ المحتوى على هذا الجهاز…',
} as const

export type ImportStatus =
  | { kind: 'idle' }
  | { kind: 'busy'; stage: keyof typeof importStages }
  | { kind: 'success'; duplicate?: boolean }
  | { kind: 'error'; message: string }

const format = new Intl.NumberFormat('ar-u-nu-arab')
const stages = Object.keys(importStages)

export function EducationImport({ entries, chapters, activities, loading, storageIssue, status, onImport }: {
  entries: number | null; chapters: number | null; activities: number | null
  loading: boolean; storageIssue: boolean; status: ImportStatus; onImport: (file: File) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const busy = status.kind === 'busy'
  const counts = [['مفردة', entries], ['فصلًا', chapters], ['نشاطًا', activities]] as const

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file) onImport(file)
  }

  return <section className="settings-section education-import" aria-labelledby="education-import-title">
    <h2 id="education-import-title">استيراد المحتوى التعليمي</h2>
    <p>اختر ملف المحتوى الموحّد. يُقرأ من جهازك ويُحفظ في هذا المتصفح.</p>
    {loading ? <p role="status">جارٍ فتح المحتوى المحفوظ…</p> : (entries !== null || chapters !== null) &&
      <dl className="education-counts" aria-label="المحتوى المحفوظ">
        {counts.map(([label, value]) => <div key={label}>
          <dt>{label}</dt><dd>{value === null ? 'غير مستورد' : format.format(value)}</dd>
        </div>)}
      </dl>}
    <input ref={input} id="education-file" type="file" accept=".json,application/json" hidden onChange={choose} disabled={loading || busy} />
    <button type="button" className="button primary" onClick={() => input.current?.click()} disabled={loading || busy}>
      استيراد ملف المحتوى
    </button>
    {busy && <div className="education-progress">
      <p role="status">{importStages[status.stage]}</p>
      <progress aria-label="تقدّم الاستيراد" max={stages.length} value={stages.indexOf(status.stage)} />
    </div>}
    {status.kind === 'success' && <p role="status">{status.duplicate ? 'ملف المحتوى محفوظ بالفعل.' : 'تم استيراد المحتوى التعليمي وحفظه على هذا الجهاز.'}</p>}
    {status.kind === 'error' && <p role="alert">{status.message}{(entries !== null || chapters !== null) && ' المحتوى السابق ما زال محفوظًا.'}</p>}
    {storageIssue && <p role="alert">تعذّر فتح بعض المحتوى المحفوظ. تحقّق من إعدادات التخزين في المتصفح.</p>}
  </section>
}
