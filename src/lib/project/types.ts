/**
 * Project File System Types
 * Defines the structure for managing LaTeX project files
 */

import type { ResearchNodeType } from '@/app/research/research-node'

/**
 * LaTeX template information
 */
export interface LatexTemplate {
  // Document class
  documentClass: string // e.g., "article", "ctexart", "IEEEtran"
  documentClassOptions?: string[] // e.g., ["12pt", "a4paper"]

  // Preamble content
  preamble: string // Full preamble including packages and settings

  // Parsed package information
  packages: {
    name: string
    options?: string[]
  }[]

  // Bibliography settings
  bibliography?: {
    style: string // e.g., "plain", "gbt7714-numerical"
    command: string // e.g., "\\bibliographystyle{plain}"
  }

  // Custom commands and definitions
  customCommands?: string[]

  // Metadata
  metadata: {
    title?: string
    author?: string
    date?: string
    language?: 'en' | 'zh' | 'auto'
    imported?: boolean // Whether this template was imported
    importSource?: string // Original file name
    createdAt?: string
    updatedAt?: string
  }
}

/**
 * File types in the project
 */
export type ProjectFileType =
  | 'generated'   // Auto-generated, read-only
  | 'editable'    // User can edit
  | 'asset'       // Images, PDFs, etc.
  | 'directory'   // Folder

/**
 * Individual file in the project
 */
export interface ProjectFile {
  name: string
  type: ProjectFileType
  path: string // Relative path in project
  content?: string // Text content (for .tex, .bib files)
  blob?: Blob // Binary content (for images, PDFs)
  size?: number
  mimeType?: string
  metadata?: {
    editable: boolean
    description?: string
    lastModified?: string
  }
}

/**
 * Directory in the project
 */
export interface ProjectDirectory {
  name: string
  path: string
  type: 'directory'
  files: (ProjectFile | ProjectDirectory)[]
}

/**
 * Complete project file system
 */
export interface ProjectFileSystem {
  // Template information
  template: LatexTemplate

  // File structure
  files: Map<string, ProjectFile | ProjectDirectory>

  // Project metadata
  metadata: {
    projectName: string
    version: string
    createdAt: string
    updatedAt: string
  }
}

/**
 * Template preset types
 */
export type TemplatePresetType =
  | 'chinese-gb'      // Chinese GB/T 7714
  | 'english-article' // Standard English article
  | 'ieee'            // IEEE conference/journal
  | 'acm'             // ACM conference
  | 'springer'        // Springer LNCS
  | 'custom'          // User-defined

/**
 * Template preset definition
 */
export interface TemplatePreset {
  id: TemplatePresetType
  name: string
  description: string
  language: 'en' | 'zh'
  documentClass: string
  documentClassOptions: string[]
  packages: string[]
  preambleTemplate: string
  sectionNames: {
    introduction: string
    'related-work': string
    method: string
    experiment: string
    result: string
    discussion: string
    conclusion: string
    acknowledgments: string
    reference: string
    appendix: string
  }
}

/**
 * Export options
 */
export interface ExportOptions {
  // Template source
  useOriginalTemplate?: boolean // Use imported template
  templatePreset?: TemplatePresetType // Or use preset
  customTemplate?: LatexTemplate // Or custom template

  // Export format
  format: 'tex' | 'zip'

  // Include files
  includeReferences?: boolean
  includeFigures?: boolean
  includePreamble?: boolean

  // File structure
  splitSections?: boolean // Export sections as separate files

  // Metadata
  metadata?: {
    title?: string
    author?: string
    date?: string
  }
}

/**
 * Research node data for export/import
 */
export interface ResearchNodeData {
  section: ResearchNodeType
  content: string
  order: number
  level: number
  parentId?: string
  customLabel?: string
  tags?: string[]
  metadata?: {
    sectionNumber?: string
  }
}

/**
 * Import result
 */
export interface ImportResult {
  // Extracted template
  template: LatexTemplate

  // Parsed content
  nodes: ResearchNodeData[]

  // Extracted files
  files: {
    figures?: Map<string, Blob>
    bibliography?: string
    additionalFiles?: Map<string, string | Blob>
  }

  // Import metadata
  metadata: {
    sourceFileName: string
    importedAt: string
    warnings?: string[]
  }
}
