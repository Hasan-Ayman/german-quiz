import { grammarModes, grammarTypes, selectableTypes } from './question-types'
import { sourceParts } from './source-data'
import type { PersonalQuiz } from './personal-quiz'
import type { QuizSettings } from './storage'

const partLabels = { noun: 'الأسماء', verb: 'الأفعال', adjective: 'الصفات', adverb: 'الظروف' }

export function QuizFilters({ bank, settings, update, available }: {
  bank: PersonalQuiz
  settings: QuizSettings
  update: (settings: QuizSettings) => void
  available: ReadonlySet<string>
}) {
  const chapters = (bank.chapters ?? []).filter(chapter => settings.level === 'A2' || chapter.level === 'A1')
  const selectedChapters = settings.chapters ?? []
  const selectedTypes = settings.types ?? selectableTypes
  return (
    <section className="quiz-filters" aria-label="اختيار محتوى الاختبار">
      <details>
        <summary>أنواع الأسئلة</summary>
        <div className="filter-actions">
          <button type="button" onClick={() => update({ ...settings, types: undefined })}>اختيار الكل</button>
          <button type="button" onClick={() => update({ ...settings, types: [] })}>إلغاء الاختيار</button>
        </div>
        {sourceParts.map(part => (
          <fieldset key={part}>
            <legend>{partLabels[part]}</legend>
            {[
              [part + ':de-ar', 'معنى الكلمة بالعربية'],
              [part + ':ar-de', 'معنى الكلمة بالألمانية'],
              ...(part === 'noun' ? [['article', 'أداة التعريف']] : []),
              ...grammarModes.filter(mode => grammarTypes[mode][0] === part)
                .map(mode => [mode, grammarTypes[mode][1]]),
            ].map(([type, label]) => (
              <label key={type} className="filter-choice">
                <input type="checkbox" checked={selectedTypes.includes(type)}
                  onChange={event => update({ ...settings, types: event.target.checked
                    ? [...selectedTypes, type] : selectedTypes.filter(value => value !== type) })} />
                {label}{!available.has(type) && <small> · لا توجد أسئلة متاحة</small>}
              </label>
            ))}
          </fieldset>
        ))}
      </details>
      <details>
        <summary>الفصول</summary>
        <button type="button" onClick={() => update({ ...settings, chapters: undefined })}>كل الفصول</button>
        {chapters.map(chapter => (
          <label key={chapter.key} className="filter-choice">
            <input type="checkbox" checked={selectedChapters.includes(chapter.key)}
              onChange={event => update({ ...settings, chapters: event.target.checked
                ? [...selectedChapters, chapter.key] : selectedChapters.filter(value => value !== chapter.key) })} />
            <bdi lang="de" dir="ltr">{chapter.level} · {chapter.number}. {chapter.title}</bdi>
          </label>
        ))}
      </details>
    </section>
  )
}
