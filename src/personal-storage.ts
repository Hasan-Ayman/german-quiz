import type { PersonalDataset } from './personal-data'
import { storageImportProblem } from './import-problem.ts'

const databaseName = 'german-quiz-personal'
const storeName = 'vocabulary'
const datasetKey = 'active'
const legacyBackupKey = 'backup-v1'

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, 1)
    let blocked = false
    request.onupgradeneeded = () => request.result.createObjectStore(storeName)
    request.onblocked = () => {
      blocked = true
      reject(new DOMException('Close other tabs using the vocabulary database', 'InvalidStateError'))
    }
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => database.close()
      if (blocked) database.close()
      else resolve(database)
    }
    request.onerror = () => reject(request.error)
  })
}

export async function loadPersonalDataset(factory = indexedDB): Promise<unknown> {
  const database = await openDatabase(factory)
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readonly')
      const request = transaction.objectStore(storeName).get(datasetKey)
      transaction.oncomplete = () => resolve(request.result ?? null)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}

export async function savePersonalDataset(dataset: PersonalDataset, factory?: IDBFactory): Promise<void> {
  let database: IDBDatabase | undefined
  try {
    const opened = await openDatabase(factory ?? globalThis.indexedDB)
    database = opened
    await new Promise<void>((resolve, reject) => {
      const transaction = opened.transaction(storeName, 'readwrite')
      let failure: unknown
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(failure ?? transaction.error)
      function attempt(write: () => void) {
        try {
          write()
        } catch (error) {
          failure = error
          try {
            transaction.abort()
          } catch {
            reject(error)
          }
        }
      }
      function observe(request: IDBRequest) {
        request.onerror = () => { failure ??= request.error }
      }
      attempt(() => {
        const store = transaction.objectStore(storeName)
        if (dataset.version === 2) {
          const previous = store.get(datasetKey)
          observe(previous)
          previous.onsuccess = () => attempt(() => {
            if (previous.result?.version === 1) observe(store.put(previous.result, legacyBackupKey))
            observe(store.put(dataset, datasetKey))
          })
        } else {
          observe(store.put(dataset, datasetKey))
        }
      })
    })
  } catch (error) {
    throw storageImportProblem(error)
  } finally {
    database?.close()
  }
}
