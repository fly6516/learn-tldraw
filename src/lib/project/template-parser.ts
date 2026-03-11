/**
 * LaTeX Template Parser
 * Extracts template information from imported LaTeX files
 */

import { LatexTemplate } from './types'

/**
 * Parse LaTeX preamble to extract template information
 */
export function parseLatexTemplate(content: string): LatexTemplate {
  const lines = content.split('\n')

  // Extract document class
  const docClassMatch = content.match(/\\documentclass(?:\[(.*?)\])?\{(.*?)\}/)
  const documentClass = docClassMatch?.[2] || 'article'
  const documentClassOptions = docClassMatch?.[1]
    ? docClassMatch[1].split(',').map(opt => opt.trim())
    : []

  // Extract preamble (everything before \begin{document})
  const preambleMatch = content.match(/([\s\S]*?)\\begin\{document\}/)
  const preamble = preambleMatch?.[1] || ''

  // Extract packages
  const packages: { name: string; options?: string[] }[] = []
  const packageRegex = /\\usepackage(?:\[(.*?)\])?\{(.*?)\}/g
  let match
  while ((match = packageRegex.exec(preamble)) !== null) {
    const options = match[1] ? match[1].split(',').map(opt => opt.trim()) : undefined
    const packageNames = match[2].split(',').map(pkg => pkg.trim())
    packageNames.forEach(name => {
      packages.push({ name, options })
    })
  }

  // Extract bibliography settings
  let bibliography: LatexTemplate['bibliography'] = undefined
  const bibStyleMatch = preamble.match(/\\bibliographystyle\{(.*?)\}/)
  if (bibStyleMatch) {
    bibliography = {
      style: bibStyleMatch[1],
      command: bibStyleMatch[0],
    }
  }

  // Extract custom commands
  const customCommands: string[] = []
  const commandRegex = /\\(?:newcommand|renewcommand|def)\{.*?\}\{.*?\}/g
  let cmdMatch
  while ((cmdMatch = commandRegex.exec(preamble)) !== null) {
    customCommands.push(cmdMatch[0])
  }

  // Extract metadata
  const titleMatch = content.match(/\\title\{(.*?)\}/)
  const authorMatch = content.match(/\\author\{(.*?)\}/)
  const dateMatch = content.match(/\\date\{(.*?)\}/)

  // Detect language
  let language: 'en' | 'zh' | 'auto' = 'auto'
  if (documentClass.includes('ctex') || packages.some(pkg => pkg.name.includes('ctex'))) {
    language = 'zh'
  } else if (packages.some(pkg => pkg.name === 'babel' && pkg.options?.includes('chinese'))) {
    language = 'zh'
  } else {
    language = 'en'
  }

  return {
    documentClass,
    documentClassOptions,
    preamble,
    packages,
    bibliography,
    customCommands: customCommands.length > 0 ? customCommands : undefined,
    metadata: {
      title: titleMatch?.[1],
      author: authorMatch?.[1],
      date: dateMatch?.[1],
      language,
      imported: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  }
}

/**
 * Generate LaTeX preamble from template
 */
export function generatePreamble(template: LatexTemplate): string {
  let preamble = ''

  // Document class
  const options = template.documentClassOptions?.length
    ? `[${template.documentClassOptions.join(',')}]`
    : ''
  preamble += `\\documentclass${options}{${template.documentClass}}\n\n`

  // Use stored preamble if available (for imported templates)
  if (template.metadata.imported && template.preamble) {
    // Extract everything after documentclass
    const preambleContent = template.preamble
      .replace(/\\documentclass.*?\n/, '')
      .trim()
    if (preambleContent) {
      preamble += preambleContent + '\n\n'
      return preamble
    }
  }

  // Otherwise, generate from packages
  if (template.packages.length > 0) {
    preamble += '% Packages\n'
    template.packages.forEach(pkg => {
      const options = pkg.options?.length ? `[${pkg.options.join(',')}]` : ''
      preamble += `\\usepackage${options}{${pkg.name}}\n`
    })
    preamble += '\n'
  }

  // Bibliography
  if (template.bibliography) {
    preamble += '% Bibliography\n'
    preamble += `${template.bibliography.command}\n\n`
  }

  // Custom commands
  if (template.customCommands?.length) {
    preamble += '% Custom commands\n'
    template.customCommands.forEach(cmd => {
      preamble += `${cmd}\n`
    })
    preamble += '\n'
  }

  return preamble
}

/**
 * Merge user edits into template
 */
export function mergeTemplateEdits(
  original: LatexTemplate,
  userPreamble: string
): LatexTemplate {
  // Parse user's preamble additions
  const userPackages: { name: string; options?: string[] }[] = []
  const packageRegex = /\\usepackage(?:\[(.*?)\])?\{(.*?)\}/g
  let match
  while ((match = packageRegex.exec(userPreamble)) !== null) {
    const options = match[1] ? match[1].split(',').map(opt => opt.trim()) : undefined
    const packageNames = match[2].split(',').map(pkg => pkg.trim())
    packageNames.forEach(name => {
      // Only add if not already in original
      if (!original.packages.some(pkg => pkg.name === name)) {
        userPackages.push({ name, options })
      }
    })
  }

  // Extract custom commands from user preamble
  const userCommands: string[] = []
  const commandRegex = /\\(?:newcommand|renewcommand|def)\{.*?\}\{.*?\}/g
  let cmdMatch
  while ((cmdMatch = commandRegex.exec(userPreamble)) !== null) {
    userCommands.push(cmdMatch[0])
  }

  return {
    ...original,
    packages: [...original.packages, ...userPackages],
    customCommands: [
      ...(original.customCommands || []),
      ...userCommands,
    ],
    preamble: original.preamble + '\n\n% User additions\n' + userPreamble,
    metadata: {
      ...original.metadata,
      updatedAt: new Date().toISOString(),
    },
  }
}

/**
 * Validate template
 */
export function validateTemplate(template: LatexTemplate): {
  valid: boolean
  errors: string[]
  warnings: string[]
} {
  const errors: string[] = []
  const warnings: string[] = []

  // Check document class
  if (!template.documentClass) {
    errors.push('Document class is required')
  }

  // Check for common issues
  if (template.documentClass.includes('ctex') &&
      !template.documentClassOptions?.includes('UTF8')) {
    warnings.push('CTeX document class should include UTF8 option')
  }

  // Check package conflicts
  const packageNames = template.packages.map(pkg => pkg.name)
  if (packageNames.includes('cite') && packageNames.includes('natbib')) {
    warnings.push('cite and natbib packages may conflict')
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}
