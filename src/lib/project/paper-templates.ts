import JSZip from 'jszip'
import { defaultCompileProfile, type CompileProfile } from './compile-profile'
import { importSourceArchive } from './source-archive'
import type { ProjectFileSystem } from './types'

type PaperTemplate = {
  id: string
  name: string
  language: string
  version: string
  sections: readonly string[]
  mainFile: string
  compileProfile: CompileProfile
  compileDescription: string
}

const articleTemplate = {
  id: 'english-article',
  name: 'English article',
  language: 'English',
  version: '1.0.0',
  sections: ['Abstract', 'Introduction', 'Methods', 'Results', 'Discussion', 'References'],
  mainFile: 'main.tex',
  compileProfile: defaultCompileProfile,
  compileDescription: 'Tectonic',
} as const satisfies PaperTemplate

const chineseArticleTemplate = {
  id: 'chinese-article',
  name: 'Chinese research article',
  language: '简体中文',
  version: '1.0.0',
  sections: ['摘要', '引言', '研究方法', '结果', '讨论', '参考文献'],
  mainFile: 'main.tex',
  compileProfile: { engine: 'xelatex', bibliography: 'bibtex' },
  compileDescription: 'XeLaTeX + BibTeX. Requires local TeX Live with ctex and Fandol fonts.',
} as const satisfies PaperTemplate

export const springerTemplate = {
  id: 'springer-nature',
  name: 'Springer Nature journal article',
  language: 'English',
  version: '2024-12',
  sections: ['Abstract', 'Main text', 'Figures and tables', 'Declarations', 'References'],
  mainFile: 'sn-article-template/sn-article.tex',
  compileProfile: { engine: 'pdflatex', bibliography: 'bibtex' },
  compileDescription: 'External pdfLaTeX + BibTeX build. The example includes EPS figures.',
  sourceUrl: 'https://www.springernature.com/in/authors/campaigns/latex-author-support',
  sha256: '812e76dcaa9c28dc1bff1fb6065d51729b67d4ea140552a05088317414a3ecae',
} as const satisfies PaperTemplate & { sourceUrl: string; sha256: string }

export const builtInPaperTemplates = [articleTemplate, chineseArticleTemplate] as const
export const paperTemplates = [...builtInPaperTemplates, springerTemplate] as const
export type PaperTemplateId = (typeof paperTemplates)[number]['id']
type BuiltInId = (typeof builtInPaperTemplates)[number]['id']

const englishFiles = {
  'main.tex': String.raw`\documentclass{article}
\title{Your paper title}
\author{Author name}
\date{}

\begin{document}
\maketitle
\input{sections/abstract}
\input{sections/introduction}
\input{sections/methods}
\input{sections/results}
\input{sections/discussion}
\bibliographystyle{plain}
\bibliography{references}
\end{document}
`,
  'sections/abstract.tex': String.raw`\begin{abstract}
Summarize the research question, methods, and main findings.
\end{abstract}
`,
  'sections/introduction.tex': String.raw`\section{Introduction}
Explain the research question and how it relates to prior work.

% Example citation. Replace it with a source relevant to your paper.
An example reference is included here~\cite{example}.
`,
  'sections/methods.tex': String.raw`\section{Methods}
Describe the study design and how you collected and analyzed the data.
`,
  'sections/results.tex': String.raw`\section{Results}
Report the findings and point the reader to the relevant figures or tables.
`,
  'sections/discussion.tex': String.raw`\section{Discussion}
Explain how the findings answer the research question, and describe any limitations.
`,
  'references.bib': `@misc{example,
  author = {Example, A.},
  title = {Replace this sample bibliography entry},
  note = {Placeholder}
}
`,
}

const chineseFiles = {
  'main.tex': String.raw`% !TeX program = xelatex
\documentclass[UTF8,fontset=fandol]{ctexart}
` + ['\\title{论文标题}', '\\author{作者姓名}'].join('\n') + String.raw`
\date{}
\begin{document}
\maketitle
\input{sections/abstract}
\input{sections/introduction}
\input{sections/methods}
\input{sections/results}
\input{sections/discussion}
\bibliographystyle{plain}
\bibliography{references}
\end{document}
`,
  'sections/abstract.tex': ['\\begin{abstract}', '概述研究问题、方法和主要发现。', '\\end{abstract}', ''].join('\n'),
  'sections/introduction.tex': ['\\section{引言}', '说明研究背景和研究问题。请替换示例引用~\\cite{example}。', ''].join('\n'),
  'sections/methods.tex': ['\\section{研究方法}', '说明研究设计、数据来源与分析方法。', ''].join('\n'),
  'sections/results.tex': ['\\section{结果}', '报告主要发现，并注明对应的图或表。', ''].join('\n'),
  'sections/discussion.tex': ['\\section{讨论}', '解释研究结果、适用范围和局限。', ''].join('\n'),
  'references.bib': `@misc{example,
  author = {Example, A.},
  title = {Replace this sample bibliography entry},
  note = {Placeholder}
}
`,
}

const builtInFiles: Record<BuiltInId, Record<string, string>> = {
  'english-article': englishFiles,
  'chinese-article': chineseFiles,
}

async function digest(bytes: ArrayBuffer) {
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function createTemplateProject(templateId: BuiltInId, name: string): Promise<ProjectFileSystem> {
  const template = templateId === articleTemplate.id ? articleTemplate : chineseArticleTemplate
  const zip = new JSZip()
  // Pin member dates so the provenance identifies the same source ZIP across projects.
  const date = new Date('2000-01-01T00:00:00Z')
  for (const [path, text] of Object.entries(builtInFiles[templateId])) zip.file(path, text, { date, createFolders: false })
  const bytes = await zip.generateAsync({ type: 'arraybuffer' })
  return openTemplateArchive(new File([bytes], template.id + '.zip'), template, name, await digest(bytes))
}

export async function importSpringerTemplate(file: File, name: string): Promise<ProjectFileSystem> {
  if (file.size > 128 * 1024 * 1024 || await digest(await file.arrayBuffer()) !== springerTemplate.sha256) {
    throw new Error('Choose the December 2024 ZIP from Springer Nature. For another release, use Import project.')
  }
  return openTemplateArchive(file, springerTemplate, name, springerTemplate.sha256)
}

async function openTemplateArchive(file: File, template: PaperTemplate, name: string, sha256: string) {
  const project = await importSourceArchive(file)
  return {
    ...project,
    metadata: {
      ...project.metadata,
      projectName: name,
      mainFile: template.mainFile,
      compileProfile: template.compileProfile,
      templateOrigin: { id: template.id, version: template.version, sha256 },
    },
  }
}
