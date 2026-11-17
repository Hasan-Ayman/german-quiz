import { ImportProblem, importMessage } from './import-problem.ts'
import { maximumDatasetBytes, readPrivateJson, validatePersonalDataset, type PersonalDataset } from './personal-data.ts'
import { validateStudyPack, type StudyPack } from './study-content.ts'

export const educationFormat = 'german-quiz-education'
export const educationVersion = 1
export const educationFilename = 'german-quiz-complete-private.json'
export const maximumEducationBytes = maximumDatasetBytes + 8 * 1024 * 1024

export type EducationPackage = {
  format: typeof educationFormat
  version: typeof educationVersion
  vocabulary: PersonalDataset
  study: StudyPack
}

export function validateEducationPackage(input: unknown): EducationPackage {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ImportProblem('schema', 'Expected an education package')
  const value = input as Record<string, unknown>
  if (value.format !== educationFormat || value.version !== educationVersion) {
    throw new ImportProblem('schema', 'Unsupported unified education package')
  }
  if (!Object.hasOwn(value, 'vocabulary') || !Object.hasOwn(value, 'study')) {
    throw new ImportProblem('missing', 'Both parts of the unified package are required')
  }
  const vocabulary = validatePersonalDataset(value.vocabulary)
  try {
    return { ...value, format: educationFormat, version: educationVersion, vocabulary, study: validateStudyPack(value.study) }
  } catch (error) {
    throw new ImportProblem('study', 'Invalid study content', undefined, undefined, { cause: error })
  }
}

export function createEducationPackage(vocabulary: PersonalDataset, study: StudyPack): EducationPackage {
  return { format: educationFormat, version: educationVersion, vocabulary, study }
}

export const readEducationFile = (file: Parameters<typeof readPrivateJson>[0]) => readPrivateJson(file, maximumEducationBytes)
export const serializeEducationPackage = (content: EducationPackage) => JSON.stringify(content) + '\n'

export function educationImportMessage(error: unknown) {
  if (!(error instanceof ImportProblem)) return 'حدث خطأ أثناء تجهيز المحتوى. أعد فتح التطبيق وحاول مجددًا.'
  switch (error.code) {
    case 'empty': return 'الملف فارغ. اختر ملف المحتوى التعليمي الكامل.'
    case 'size': return 'ملف المحتوى أكبر من الحجم المدعوم (٢٠ ميبيبايت). اختر النسخة الأصلية.'
    case 'schema': return 'تنسيق ملف المحتوى أو إصداره غير مدعوم. اختر ملف المحتوى التعليمي الموحّد.'
    case 'missing': return 'ملف المحتوى ناقص. اختر النسخة الكاملة التي تتضمن المفردات ومحتوى الدراسة.'
    default: return importMessage(error)
  }
}
