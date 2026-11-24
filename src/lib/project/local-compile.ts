import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ProjectFileSystem } from './types'

const processState = globalThis as typeof globalThis & { researchCanvasCompile?: 'project' | 'resources' }

export function claimLocalCompiler(task: 'project' | 'resources') {
  if (processState.researchCanvasCompile) return
  processState.researchCanvasCompile = task
  return () => { delete processState.researchCanvasCompile }
}

export function currentLocalCompile() {
  return processState.researchCanvasCompile
}

export async function writeCompileSources(folder: string, project: ProjectFileSystem) {
  for (const entry of project.files.values()) {
    const path = join(folder, entry.path)
    if (entry.type === 'directory') await mkdir(path, { recursive: true })
    else if (entry.blob) {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, new Uint8Array(await entry.blob.arrayBuffer()), { flag: 'wx' })
    }
  }
}
