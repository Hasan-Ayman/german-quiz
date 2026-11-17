import { validateEducationPackage, type EducationPackage } from './education-package.ts'
import { storageImportProblem } from './import-problem.ts'
import { validatePersonalDataset, type PersonalDataset } from './personal-data.ts'
import { loadPersonalDataset } from './personal-storage.ts'
import { validateStudyPack, type StudyPack } from './study-content.ts'
import { readStudyRecord, updateStudyRecord } from './study-storage.ts'

const educationKey = 'education'

type StoredEducation = { sha256: string; content: EducationPackage }
type Library = { vocabulary: PersonalDataset | null; study: StudyPack | null; storageIssue: boolean }

export async function loadEducationLibrary(factory = indexedDB): Promise<Library> {
  let storageIssue = false
  try {
    const saved = await readStudyRecord(educationKey, factory) as StoredEducation | null
    if (saved) {
      const { vocabulary, study } = validateEducationPackage(saved.content)
      return { vocabulary, study, storageIssue }
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

export async function saveEducationPackage(content: EducationPackage, factory = indexedDB) {
  try {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(content)))
    const sha256 = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
    const next: StoredEducation = { sha256, content }
    const committed = await updateStudyRecord<StoredEducation>(educationKey, previous => {
      const current = previous as StoredEducation | null
      return current?.sha256 === sha256 ? current : next
    }, factory)
    return committed === next
  } catch (error) {
    throw storageImportProblem(error)
  }
}
