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
  const [updated] = await updateStudyRecords([key], ([previous]) => [modify(previous)], factory)
  return updated as T
}

export async function updateStudyRecords(keys: readonly string[], modify: (previous: unknown[]) => unknown[], factory = indexedDB) {
  const database = await openStudyDatabase(factory)
  try {
    return await new Promise<unknown[]>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      const records: unknown[] = Array(keys.length)
      let remaining = keys.length
      let updated: unknown[]
      let failure: unknown
      transaction.oncomplete = () => resolve(updated)
      transaction.onabort = () => reject(failure ?? transaction.error)
      keys.forEach((key, index) => {
        const read = store.get(key)
        read.onerror = () => { failure = read.error }
        read.onsuccess = () => {
          records[index] = read.result ?? null
          if (--remaining !== 0) return
          try {
            updated = modify(records)
            for (const [i, value] of updated.entries()) {
              if (value === records[i]) continue
              const write = store.put(value, keys[i])
              write.onerror = () => { failure = write.error }
            }
          } catch (error) {
            failure = error
            transaction.abort()
          }
        }
      })
    })
  } finally {
    database.close()
  }
}

export async function writeStudyRecords(entries: readonly (readonly [string, unknown])[], factory = indexedDB) {
  const database = await openStudyDatabase(factory)
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite')
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error)
      const store = transaction.objectStore(storeName)
      try {
        for (const [key, value] of entries) store.put(value, key)
      } catch (error) {
        transaction.abort()
        reject(error)
      }
    })
  } finally {
    database.close()
  }
}

export const loadStudyPack = () => readStudyRecord('pack')
export const saveStudyPack = (pack: StudyPack) => updateStudyRecord('pack', () => pack)
