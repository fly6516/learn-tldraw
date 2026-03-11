/**
 * Project File System Manager
 * Manages the complete file structure of a LaTeX project
 */

import {
  ProjectFileSystem,
  ProjectFile,
  ProjectDirectory,
  LatexTemplate,
  ResearchNodeData,
} from './types'
import { generatePreamble } from './template-parser'

/**
 * Create a new project file system
 */
export function createProjectFileSystem(
  template: LatexTemplate,
  projectName: string = 'Untitled Project'
): ProjectFileSystem {
  const now = new Date().toISOString()

  const files = new Map<string, ProjectFile | ProjectDirectory>()

  // Main document (generated)
  files.set('main.tex', {
    name: 'main.tex',
    type: 'generated',
    path: 'main.tex',
    content: '',
    metadata: {
      editable: false,
      description: 'Main document (auto-generated from nodes)',
      lastModified: now,
    },
  })

  // User-editable preamble
  files.set('preamble.tex', {
    name: 'preamble.tex',
    type: 'editable',
    path: 'preamble.tex',
    content: '% Add custom packages and commands here\n',
    metadata: {
      editable: true,
      description: 'Custom preamble additions',
      lastModified: now,
    },
  })

  // Figures directory
  const figuresDir: ProjectDirectory = {
    name: 'figures',
    path: 'figures/',
    type: 'directory',
    files: [],
  }
  files.set('figures/', figuresDir)

  return {
    template,
    files,
    metadata: {
      projectName,
      version: '1.0.0',
      createdAt: now,
      updatedAt: now,
    },
  }
}

/**
 * Add a file to the project
 */
export function addFile(
  fs: ProjectFileSystem,
  file: ProjectFile | ProjectDirectory
): ProjectFileSystem {
  const newFiles = new Map(fs.files)
  newFiles.set(file.path, file)

  return {
    ...fs,
    files: newFiles,
    metadata: {
      ...fs.metadata,
      updatedAt: new Date().toISOString(),
    },
  }
}

/**
 * Delete a file from the project
 */
export function deleteFile(
  fs: ProjectFileSystem,
  path: string
): ProjectFileSystem {
  const newFiles = new Map(fs.files)
  newFiles.delete(path)

  return {
    ...fs,
    files: newFiles,
    metadata: {
      ...fs.metadata,
      updatedAt: new Date().toISOString(),
    },
  }
}

/**
 * Update file content
 */
export function updateFileContent(
  fs: ProjectFileSystem,
  path: string,
  content: string | Blob
): ProjectFileSystem {
  const file = fs.files.get(path)
  if (!file || file.type === 'directory') {
    throw new Error(`File not found or is a directory: ${path}`)
  }

  const projectFile = file as ProjectFile
  if (!projectFile.metadata?.editable && projectFile.type !== 'generated') {
    throw new Error(`File is not editable: ${path}`)
  }

  const newFiles = new Map(fs.files)
  newFiles.set(path, {
    ...projectFile,
    content: typeof content === 'string' ? content : undefined,
    blob: content instanceof Blob ? content : undefined,
    metadata: {
      editable: projectFile.metadata?.editable ?? false,
      description: projectFile.metadata?.description,
      lastModified: new Date().toISOString(),
    },
  })

  return {
    ...fs,
    files: newFiles,
    metadata: {
      ...fs.metadata,
      updatedAt: new Date().toISOString(),
    },
  }
}

/**
 * Add figure to project
 */
export function addFigure(
  fs: ProjectFileSystem,
  fileName: string,
  blob: Blob
): ProjectFileSystem {
  const figuresDir = fs.files.get('figures/') as ProjectDirectory
  if (!figuresDir) {
    throw new Error('Figures directory not found')
  }

  const figure: ProjectFile = {
    name: fileName,
    type: 'asset',
    path: `figures/${fileName}`,
    blob,
    size: blob.size,
    mimeType: blob.type,
    metadata: {
      editable: false,
      description: 'Figure',
      lastModified: new Date().toISOString(),
    },
  }

  // Add to figures directory
  const newFiguresDir: ProjectDirectory = {
    ...figuresDir,
    files: [...figuresDir.files, figure],
  }

  const newFiles = new Map(fs.files)
  newFiles.set('figures/', newFiguresDir)
  newFiles.set(figure.path, figure)

  return {
    ...fs,
    files: newFiles,
    metadata: {
      ...fs.metadata,
      updatedAt: new Date().toISOString(),
    },
  }
}

/**
 * Remove file from project
 */
export function removeFile(
  fs: ProjectFileSystem,
  path: string
): ProjectFileSystem {
  const newFiles = new Map(fs.files)

  // If it's in a directory, remove from directory too
  if (path.includes('/')) {
    const dirPath = path.substring(0, path.lastIndexOf('/') + 1)
    const dir = newFiles.get(dirPath) as ProjectDirectory
    if (dir) {
      const newDir: ProjectDirectory = {
        ...dir,
        files: dir.files.filter(f => f.path !== path),
      }
      newFiles.set(dirPath, newDir)
    }
  }

  newFiles.delete(path)

  return {
    ...fs,
    files: newFiles,
    metadata: {
      ...fs.metadata,
      updatedAt: new Date().toISOString(),
    },
  }
}

/**
 * Get file by path
 */
export function getFile(
  fs: ProjectFileSystem,
  path: string
): ProjectFile | ProjectDirectory | undefined {
  return fs.files.get(path)
}

/**
 * List all files (flat)
 */
export function listAllFiles(fs: ProjectFileSystem): ProjectFile[] {
  const files: ProjectFile[] = []

  fs.files.forEach(item => {
    if (item.type === 'directory') {
      const dir = item as ProjectDirectory
      dir.files.forEach(f => {
        if (f.type !== 'directory') {
          files.push(f as ProjectFile)
        }
      })
    } else {
      files.push(item as ProjectFile)
    }
  })

  return files
}

/**
 * Get file tree structure (for UI display)
 */
export interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  editable: boolean
  children?: FileTreeNode[]
  size?: number
  mimeType?: string
}

export function getFileTree(fs: ProjectFileSystem): FileTreeNode[] {
  const tree: FileTreeNode[] = []

  // Sort: directories first, then files
  const sorted = Array.from(fs.files.values()).sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1
    if (a.type !== 'directory' && b.type === 'directory') return 1
    return a.name.localeCompare(b.name)
  })

  sorted.forEach(item => {
    if (item.type === 'directory') {
      const dir = item as ProjectDirectory
      tree.push({
        name: dir.name,
        path: dir.path,
        type: 'directory',
        editable: false,
        children: dir.files.map(f => ({
          name: f.name,
          path: f.path,
          type: f.type === 'directory' ? 'directory' : 'file',
          editable: (f as ProjectFile).metadata?.editable || false,
          size: (f as ProjectFile).size,
          mimeType: (f as ProjectFile).mimeType,
        })),
      })
    } else {
      const file = item as ProjectFile
      // Only show top-level files (not in directories)
      if (!file.path.includes('/')) {
        tree.push({
          name: file.name,
          path: file.path,
          type: 'file',
          editable: file.metadata?.editable || false,
          size: file.size,
          mimeType: file.mimeType,
        })
      }
    }
  })

  return tree
}

/**
 * Generate main.tex content from nodes
 */
export function generateMainTex(
  fs: ProjectFileSystem,
  nodes: ResearchNodeData[],
  metadata?: {
    title?: string
    author?: string
    date?: string
  }
): string {
  const { template } = fs

  let content = ''

  // Preamble
  content += generatePreamble(template)

  // User's custom preamble
  const userPreamble = getFile(fs, 'preamble.tex') as ProjectFile
  if (userPreamble?.content && userPreamble.content.trim()) {
    content += '\n% User custom preamble\n'
    content += userPreamble.content + '\n'
  }

  // Document metadata
  content += '\n% Document metadata\n'
  if (metadata?.title || template.metadata.title) {
    content += `\\title{${metadata?.title || template.metadata.title}}\n`
  }
  if (metadata?.author || template.metadata.author) {
    content += `\\author{${metadata?.author || template.metadata.author}}\n`
  }
  if (metadata?.date || template.metadata.date) {
    content += `\\date{${metadata?.date || template.metadata.date}}\n`
  }

  // Begin document
  content += '\n\\begin{document}\n\n'

  // Title
  if (metadata?.title || template.metadata.title) {
    content += '\\maketitle\n\n'
  }

  // Content from nodes (simplified - will be enhanced later)
  content += '% Content generated from research nodes\n'
  nodes.forEach(node => {
    if (node.level === 1) {
      content += `\\section{${node.customLabel || 'Untitled'}}\n`
      if (node.content) {
        content += `${node.content}\n\n`
      }
    } else if (node.level === 2) {
      content += `\\subsection{${node.customLabel || 'Untitled'}}\n`
      if (node.content) {
        content += `${node.content}\n\n`
      }
    }
  })

  // Bibliography
  const bibFile = getFile(fs, 'references.bib')
  if (bibFile) {
    content += '\n\\bibliography{references}\n'
  }

  // End document
  content += '\\end{document}\n'

  return content
}

/**
 * Update main.tex in file system
 */
export function updateMainTex(
  fs: ProjectFileSystem,
  nodes: ResearchNodeData[],
  metadata?: {
    title?: string
    author?: string
    date?: string
  }
): ProjectFileSystem {
  const content = generateMainTex(fs, nodes, metadata)
  return updateFileContent(fs, 'main.tex', content)
}
