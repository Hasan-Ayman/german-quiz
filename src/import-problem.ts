type ImportCode = 'empty' | 'size' | 'read' | 'encoding' | 'syntax' | 'schema' |
  'missing' | 'record' | 'source' | 'study' | 'no-questions' | 'storage' | 'quota'

export class ImportProblem extends Error {
  readonly code: ImportCode
  readonly field?: string
  readonly row?: number

  constructor(code: ImportCode, message: string, field?: string, row?: number, options?: ErrorOptions) {
    super(message, options)
    this.code = code
    this.field = field
    this.row = row
  }
}

export function requireImportFields(record: Record<string, unknown>, fields: readonly string[], row?: number) {
  const missing = fields.find(field => !Object.hasOwn(record, field))
  if (missing) throw new ImportProblem('missing', 'Missing required field ' + missing, missing, row)
}

export function storageImportProblem(error: unknown) {
  return new ImportProblem(
    error && typeof error === 'object' && 'name' in error && error.name === 'QuotaExceededError' ? 'quota' : 'storage',
    'Browser could not save the vocabulary', undefined, undefined, { cause: error },
  )
}

export function importMessage(error: unknown): string {
  if (!(error instanceof ImportProblem)) return 'حدث خطأ غير متوقّع أثناء تجهيز المفردات. أعد فتح التطبيق وحاول مرة أخرى.'
  const row = error.row === undefined ? '' : ' (السجل رقم ' + new Intl.NumberFormat('ar-u-nu-arab').format(error.row) + ')'
  switch (error.code) {
    case 'empty': return 'الملف فارغ. اختر ملف المفردات الكامل.'
    case 'size': return 'حجم الملف يتجاوز ١٢ ميغابايت. اختر ملف المفردات الشخصي المخصّص للتطبيق.'
    case 'read': return 'تعذّرت قراءة الملف من الجهاز. نزّل نسخة محلية من الملف ثم أعد اختياره.'
    case 'encoding': return 'تعذّرت قراءة ترميز النص. احفظ الملف بترميز UTF-8 ثم حاول مجددًا.'
    case 'syntax': return 'بنية JSON غير صالحة. أعد نقل الملف الكامل أو اختر النسخة الأصلية.'
    case 'schema': return 'تنسيق ملف المفردات أو إصداره غير مدعوم. حدّث التطبيق واختر ملف المفردات الشخصي بالإصدار ١ أو ٢.'
    case 'missing': return 'حقل مطلوب مفقود' + row + (error.field ? ' [' + error.field + ']' : '') + '. اختر نسخة كاملة من ملف المفردات.'
    case 'record': return 'سجل مفردات أو بيانات أمثلته غير صالح' + row + '. اختر النسخة الأصلية من الملف.'
    case 'study': return 'بيانات الفصول أو الدروس أو الأنشطة غير صالحة. اختر النسخة الأصلية من الملف.'
    case 'source': return 'بيانات المصدر أو أمثلته غير صالحة' + row + '. اختر النسخة الأصلية من الملف.'
    case 'no-questions': return 'لا يمكن توليد أسئلة من المفردات الموجودة في الملف. اختر ملفًا يحتوي على مفردات مؤهلة.'
    case 'quota': return 'مساحة التخزين في المتصفح غير كافية. حرّر مساحة على الجهاز دون حذف بيانات التطبيق، ثم أعد المحاولة.'
    case 'storage': return 'تعذّر حفظ الملف في المتصفح. أغلق علامات التبويب الأخرى للتطبيق وتحقّق من السماح بالتخزين المحلي، ثم حاول مجددًا.'
  }
}
