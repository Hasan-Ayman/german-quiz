import { createEducationPackage, validateEducationPackage, type EducationPackage } from './education-package.ts'
import { storageImportProblem } from './import-problem.ts'
import { validatePersonalDataset, type PersonalDataset } from './personal-data.ts'
import { loadPersonalDataset } from './personal-storage.ts'
import { validateStudyPack, type StudyPack } from './study-content.ts'
import { readStudyRecord, updateStudyRecords } from './study-storage.ts'
import { readLocal } from './storage'
import { addLegacyRecovery, legacySessionKey, recoverBeforeImport } from './legacy-session'

const educationKey = 'education'

type StoredEducation = { sha256: string; content: EducationPackage }
type Library = { vocabulary: PersonalDataset | null; study: StudyPack | null; storageIssue: boolean; explanations?: EducationPackage['explanations']; feedback?: EducationPackage['feedback'] }

export async function loadEducationLibrary(factory = indexedDB): Promise<Library> {
  let storageIssue = false
  try {
    const saved = await readStudyRecord(educationKey, factory) as StoredEducation | null
    if (saved) {
      const { vocabulary, study } = validateEducationPackage(saved.content)
      return { vocabulary, study, storageIssue, explanations:saved.content.explanations, feedback:saved.content.feedback }
    }
  } catch {
    storageIssue = true
  }

  const [vocabulary, study] = await Promise.allSettled([
    loadPersonalDataset(factory).then(value => value === null ? null : validatePersonalDataset(value)),
    readStudyRecord('pack', factory).then(value => value === null ? null : validateStudyPack(value)),
  ])
  return { vocabulary: vocabulary.status === 'fulfilled' ? vocabulary.value : null,
    study: study.status === 'fulfilled' ? study.value : null,
    storageIssue: storageIssue || vocabulary.status === 'rejected' || study.status === 'rejected' }
}

export async function educationForExport(vocabulary: PersonalDataset, study: StudyPack, factory = indexedDB) {
  const saved = await readStudyRecord(educationKey, factory) as StoredEducation | null
  if (saved) {
    validateEducationPackage(saved.content)
    return saved.content
  }
  return validateEducationPackage(createEducationPackage(vocabulary, study))
}

export async function saveEducationPackage(content: EducationPackage, factory = indexedDB) {
  try {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(content)))
    const sha256 = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
    const next: StoredEducation = { sha256, content }
    const raw = readLocal('attempt')
    const previousLibrary = raw ? await loadEducationLibrary(factory) : null
    const recovery = raw && previousLibrary?.vocabulary ? await recoverBeforeImport(raw, previousLibrary.vocabulary) : null
    const [committed] = await updateStudyRecords(recovery ? [educationKey, legacySessionKey] : [educationKey], ([previous, archive]) => {
      const current = previous as StoredEducation | null
      return [current?.sha256 === sha256 ? current : next, ...(recovery ? [addLegacyRecovery(archive, recovery)] : [])]
    }, factory)
    return committed === next
  } catch (error) {
    throw storageImportProblem(error)
  }
}
