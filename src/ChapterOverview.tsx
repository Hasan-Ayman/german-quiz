import type { StudyChapter, StudyPack } from './study-content'
import { studyStats, type StudyEvent } from './study-progress'

const number = new Intl.NumberFormat('ar-u-nu-arab')

export function ChapterOverview({ chapter, pack, events, onRule }: {
  chapter: StudyChapter; pack: StudyPack; events: StudyEvent[]; onRule: (chapter: string, topic: string) => void
}) {
  const items = pack.questions.filter(item => item.chapter === chapter.id)
  const ids = new Set(items.map(item => item.id))
  const stats = studyStats(events.filter(item => ids.has(item.questionId)))
  return <section className="panel study-flow" aria-label="نظرة عامة على الفصل">
    <h2 lang="de" dir="ltr">{chapter.title}</h2>
    <p className="study-source"><bdi dir="ltr">{chapter.id}</bdi> · صفحات PDF {number.format(chapter.startPage)}–{number.format(chapter.endPage)}</p>
    <div className="study-flow">
      <p>إنجاز الفصل: {number.format(stats.completed)} / {number.format(items.length)}.</p>
      <progress aria-label="إنجاز الفصل" max={items.length || 1} value={stats.completed} />
      <p>{stats.mastered ? 'مؤشر إتقان الفصل محقّق' : 'إتقان الفصل قيد التمرّن'}</p>
    </div>
    <details open>
      <summary>أهداف التعلّم</summary>
      <ul lang="de" dir="ltr">{chapter.objectives.map((text, i) => <li key={i}>{text}</li>)}</ul>
    </details>
    <details>
      <summary>موضوعات الفصل وقواعده</summary>
      <ul lang="de" dir="ltr">{[...chapter.themes, ...chapter.grammar].map((text, i) => <li key={i}>{text}</li>)}</ul>
    </details>
    <details>
      <summary>النطق والاستماع</summary>
      <ul lang="de" dir="ltr">{chapter.pronunciation.map((item, i) => <li key={i}>{item}</li>)}</ul>
      <p>موضوعات النطق موثّقة في صفحة PDF {number.format(chapter.overviewPage)}.</p>
      {chapter.pageCandidates.listening?.length > 0 && <p>صفحات مرشّحة لأنشطة الاستماع: {chapter.pageCandidates.listening.map(page => number.format(page)).join('، ')}.</p>}
      <p>تسجيلات الكتاب غير مرفقة. الاستماع والإملاء باستخدام التسجيلات الأصلية غير متاحين.</p>
    </details>
    {pack.lessons.filter(lesson => lesson.chapter === chapter.id).map(lesson => <details key={lesson.topic}>
      <summary>{lesson.title}</summary>
      <p lang="ar" dir="rtl">{lesson.explanation}</p>
      <p lang="de" dir="ltr">{lesson.german}</p>
      <p lang="ar" dir="rtl">{lesson.arabic}</p>
      <small>مرجع الدرس: صفحة PDF {number.format(lesson.source.page)}</small>
      <div><button className="text-button" type="button" onClick={() => onRule(lesson.chapter, lesson.topic)}>تدرّب على هذه القاعدة</button></div>
    </details>)}
  </section>
}
