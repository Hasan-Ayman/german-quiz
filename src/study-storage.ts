import type { StudyPack } from './study-content.ts'

const databaseName = 'german-quiz-study'
const storeName = 'study'

async function openStudyDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, 1)
    let blocked = false
    request.onupgradeneeded = () => request.result.createObjectStore(storeName)
    request.onblocked = () => {
      blocked = true
      reject(new Error('Close other study tabs and try again.'))
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => database.close()
      if (blocked) database.close()
      else resolve(database)
    }
  })
}

export async function readStudyRecord(key: string, factory = indexedDB): Promise<unknown> {
  const database = await openStudyDatabase(factory)
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readonly')
      const request = transaction.objectStore(storeName).get(key)
      transaction.oncomplete = () => resolve(request.result ?? null)
      transaction.onabort = () => reject(request.error ?? transaction.error)
    })
  } finally {
    database.close()
  }
}

export async function updateStudyRecord<T>(key: string, modify: (previous: unknown) => T, factory = indexedDB): Promise<T> {
  const database = await openStudyDatabase(factory)
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      let updated: T
      let failure: unknown
      transaction.oncomplete = () => resolve(updated)
      transaction.onabort = () => reject(failure ?? transaction.error)
      const previous = store.get(key)
      previous.onerror = () => { failure = previous.error }
      previous.onsuccess = () => {
        try {
          const stored = previous.result ?? null
          updated = modify(stored)
          if (updated === stored) return
          const request = store.put(updated, key)
          request.onerror = () => { failure = request.error }
        } catch (error) {
          failure = error
          transaction.abort()
        }
      }
    })
  } finally {
    database.close()
  }
}

export const loadStudyPack = () => readStudyRecord('pack')
export const saveStudyPack = (pack: StudyPack) => updateStudyRecord('pack', () => pack)
