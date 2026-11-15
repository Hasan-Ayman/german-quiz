import { pronouns, sourceParts } from './source-data.ts'

export const grammarTypes = {
  'noun-plural': ['noun', 'الجمع', 'اختر صيغة الجمع كما وردت في المصدر'],
  'noun-singular': ['noun', 'المفرد', 'اختر المفرد المطابق لصيغة الجمع'],
  'noun-synonym': ['noun', 'المرادف', 'اختر المرادف المذكور في المصدر'],
  'noun-plural-availability': ['noun', 'وجود الجمع في المصدر', 'هل يورد المصدر صيغة جمع؟'],
  'noun-context': ['noun', 'الاسم في جملة', 'اختر الجملة الألمانية المطابقة للمعنى'],
  'verb-infinitive': ['verb', 'المصدر', 'اختر المصدر المطابق للصيغتين'],
  'verb-present': ['verb', 'المضارع', 'اختر صيغة المضارع المناسبة للضمير'],
  'verb-preterite': ['verb', 'الماضي البسيط', 'اختر صيغة الماضي البسيط كما وردت'],
  'verb-perfect': ['verb', 'الماضي المركّب', 'اختر صيغة الماضي المركّب كاملة'],
  'verb-auxiliary': ['verb', 'الفعل المساعد', 'اختر الفعل المساعد في صيغة الماضي المركّب الواردة'],
  'verb-participle': ['verb', 'اسم المفعول', 'اختر صيغة Partizip II'],
  'verb-synonym': ['verb', 'المرادف', 'اختر المرادف المذكور في المصدر'],
  'verb-classification': ['verb', 'تصنيف الفعل', 'اختر التصنيف المحقّق في الفئة المحدّدة'],
  'verb-context': ['verb', 'الفعل في جملة', 'اختر الجملة الألمانية المطابقة للمعنى'],
  'adjective-comparative': ['adjective', 'المقارنة', 'اختر صيغة المقارنة'],
  'adjective-superlative': ['adjective', 'التفضيل', 'اختر صيغة التفضيل'],
  'adjective-synonym': ['adjective', 'المرادف', 'اختر المرادف المذكور في المصدر'],
  'adjective-antonym': ['adjective', 'المضاد', 'اختر المضاد المذكور في المصدر'],
  'adjective-context': ['adjective', 'الصفة في جملة', 'اختر الجملة الألمانية المطابقة للمعنى'],
  'adverb-category': ['adverb', 'نوع الظرف', 'اختر تصنيف الظرف كما ورد في المصدر'],
  'adverb-synonym': ['adverb', 'المرادف', 'اختر المرادف المذكور في المصدر'],
  'adverb-context': ['adverb', 'الظرف في جملة', 'اختر الجملة الألمانية المطابقة للمعنى'],
} as const
export type GrammarMode = keyof typeof grammarTypes
export const grammarModes = Object.keys(grammarTypes) as GrammarMode[]
export const isGrammarMode = (value: string): value is GrammarMode => Object.hasOwn(grammarTypes, value)
export const meaningTypes = sourceParts.flatMap(part => [`${part}:de-ar`, `${part}:ar-de`])
export const selectableTypes = [...meaningTypes, 'article', ...grammarModes]
export const presentPronouns = pronouns
