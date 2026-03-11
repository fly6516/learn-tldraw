/**
 * Project File System - Main Export
 *
 * This module provides a complete file system for managing LaTeX projects,
 * including templates, import/export, and file management.
 */

// Core types
export type {
  LatexTemplate,
  ProjectFileType,
  ProjectFile,
  ProjectDirectory,
  ProjectFileSystem,
  TemplatePresetType,
  TemplatePreset,
  ExportOptions,
  ImportResult,
  ResearchNodeData,
} from './types'

// Template system
export { TEMPLATE_PRESETS } from './templates'

// Template parser
export {
  parseLatexTemplate,
  generatePreamble,
  mergeTemplateEdits,
  validateTemplate,
} from './template-parser'

// File system management
export {
  createProjectFileSystem,
  addFile,
  updateFileContent,
  addFigure,
  removeFile,
  getFile,
  listAllFiles,
  getFileTree,
  type FileTreeNode,
} from './file-system'

// Import functionality
export {
  importLatexFile,
  importLatexZip,
  createProjectFromImport,
} from './importer'

// Export functionality
export {
  exportToLatexFile,
  exportToLatexZip,
} from './exporter'
