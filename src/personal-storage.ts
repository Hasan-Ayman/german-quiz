import type { PersonalDataset } from './personal-data'

const databaseName = 'german-quiz-personal'
const storeName = 'vocabulary'
const datasetKey = 'active'

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(storeName)
    request.onsuccess = () => resolve(request.result)
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

export async function savePersonalDataset(dataset: PersonalDataset, factory = indexedDB): Promise<void> {
  const database = await openDatabase(factory)
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite')
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error)
      transaction.objectStore(storeName).put(dataset, datasetKey)
    })
  } finally {
    database.close()
  }
}
