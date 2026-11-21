import type { ProjectFileSystem } from './types'

const storeName = 'projects'

export function openProjectStorage(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('learn-tldraw-projects', 1)
        request.onupgradeneeded = () => request.result.createObjectStore(storeName)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

export function readProject(database: IDBDatabase, key: string): Promise<ProjectFileSystem | undefined> {
    return new Promise((resolve, reject) => {
        const request = database.transaction(storeName).objectStore(storeName).get(key)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

export function writeProject(database: IDBDatabase, key: string, project: ProjectFileSystem): Promise<void> {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readwrite')
        transaction.oncomplete = () => resolve()
        transaction.onabort = () => reject(transaction.error)
        transaction.objectStore(storeName).put(project, key)
    })
}
