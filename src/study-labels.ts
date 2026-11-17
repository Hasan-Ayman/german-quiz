import type { StudyType } from './study-content.ts'

export const studyTypeLabels: Record<StudyType, string> = {
  cloze: 'إكمال الجمل', flashcard: 'بطاقات المفردات', verb: 'تصريف الأفعال', grammar: 'تحديات القواعد',
  reading: 'فهم المقروء', order: 'ترتيب الجملة', case: 'الحالات الإعرابية', error: 'تصحيح الأخطاء',
  transform: 'تحويل الجملة', writing: 'التعبير الكتابي', vocabulary: 'معاني المفردات وصيغها',
}
