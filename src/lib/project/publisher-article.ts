import type { ManuscriptSnapshot } from './template-export'
import { joinMappedTex, type MappedTex } from './template-source-map'

export const publisherArticleIds = ['mnras', 'elsevier-cas-sc', 'plos-one', 'ieee-compsoc', 'springer-nature', 'agu-jgr-atmospheres'] as const
export type PublisherArticleId = typeof publisherArticleIds[number]
type Part = string | MappedTex | false

// Preserve the publisher's numeric reference formatting and ordering. Natbib
// also needs author and year metadata in the label to render textual citations.
export function numericPublisherBibliography(original: string, entry: 'start.entry' | 'output.bibitem') {
  const declaration = `FUNCTION {${entry}}`
  const plainLabel = '  "\\bibitem{" write$'
  const start = original.indexOf(declaration)
  const label = original.indexOf(plainLabel, start)
  if (start < 0 || label < 0) throw new Error('官方参考文献样式缺少可识别的条目定义。')
  const names = String.raw`
STRINGS { citation.names }
FUNCTION {citation.short.author}
{ author empty$ { editor } { author } if$ 'citation.names :=
  citation.names empty$
    { "" }
    { citation.names #1 "{vv~}{ll}" format.name$
      citation.names num.names$ #2 >
        { " et~al." * }
        { citation.names num.names$ #2 =
            { citation.names #2 "{vv~}{ll}" format.name$ duplicate$ "others" =
                { pop$ " et~al." * }
                { " and " swap$ * * }
              if$
            }
            'skip$
          if$
        }
      if$
    }
  if$
}

`
  const numericLabel = String.raw`  "\bibitem[{" write$
  citation.short.author write$
  "}(" write$
  year empty$ { "" } { year } if$ write$
  ")]{" write$`
  return '% Adaptation adds natbib author/year labels to the original numeric bibliography.\n'
    + original.slice(0, start) + names + original.slice(start, label) + numericLabel + original.slice(label + plainLabel.length)
}

export function publisherArticle(
  id: PublisherArticleId, manuscript: ManuscriptSnapshot, fields: { affiliation: string; email: string; keyPoint?: string; keyPoint2?: string; keyPoint3?: string; plainLanguageSummary?: string; openResearch?: string },
  escape: (value: string) => string, officialPreamble?: string, lineNumberedDraft = false,
) {
  const title = manuscript.title
  const shortTitle = escape(title.replace(/\\([&%#$ _])/g, '$1').slice(0, 45))
  const authors = manuscript.authors.join(', ')
  const affiliation = escape(fields.affiliation.trim())
  const email = escape(fields.email.trim())
  const abstract: Part[] = [
    '\\begin{abstract}', { text: manuscript.abstract, lines: manuscript.lineSources.abstract }, '\\end{abstract}',
  ]
  const keywords = (opening: string, closing: string) => !!manuscript.keywords
    && joinMappedTex([opening, { text: manuscript.keywords, lines: manuscript.lineSources.keywords }, closing], '')
  const common = '\\usepackage{graphicx,booktabs,array,amsmath,amssymb}'
  switch (id) {
    case 'mnras':
      return {
        beforeBody: ['\\documentclass[fleqn,usenatbib]{mnras}', '\\usepackage[T1]{fontenc}', '\\usepackage{newtxtext,newtxmath}',
          '\\usepackage{graphicx,booktabs,array,amsmath}', '\\begin{document}', `\\title[${shortTitle}]{${title}}`,
          `\\author[${authors}]{${authors}${email ? `\\thanks{${email}}` : ''}\\\\${affiliation}}`,
          '\\maketitle', ...abstract, keywords('\\begin{keywords}', '\\end{keywords}')],
        bibStyle: 'mnras', packages: ['mnras.cls', 'mnras.bst'],
      }
    case 'elsevier-cas-sc':
      return {
        beforeBody: ['\\documentclass[a4paper,fleqn]{cas-sc}', '\\usepackage[T1]{fontenc}', '\\usepackage{lmodern,lastpage}',
          '\\usepackage[authoryear,longnamesfirst]{natbib}', common, '\\AtBeginDocument{\\renewcommand{\\lastpage}{\\pageref*{LastPage}}}',
          '\\begin{document}', `\\shorttitle{${title}}`, `\\shortauthors{${authors}}`, `\\title[mode=title]{${title}}`,
          ...manuscript.authors.map(name => `\\author[1]{${name}}`), !!email && `\\ead{${email}}`,
          `\\affiliation[1]{organization={${affiliation}}}`, ...abstract, keywords('\\begin{keywords}', '\\end{keywords}'), '\\maketitle', '\\suppressfloats[t]'],
        bibStyle: 'cas-model2-names', packages: ['cas-sc.cls', 'cas-common.sty', 'cas-model2-names.bst'],
      }
    case 'plos-one': {
      if (!officialPreamble) throw new Error('PLOS 源包缺少已校验的导言区。')
      return {
        beforeBody: [officialPreamble.replace(/^\\bibliographystyle\{plos2025\}\s*$/m, ''), '\\begin{document}', '\\begin{flushleft}',
          `{\\Large\\textbf{${title}}}\\par\\medskip ${authors}\\par`, affiliation,
          !!email && `\\par\\texttt{${email}}`, '\\end{flushleft}', '\\section*{Abstract}',
          { text: manuscript.abstract, lines: manuscript.lineSources.abstract }],
        bibStyle: 'plos-numeric-natbib', packages: ['plos2025.bst'],
      }
    }
    case 'springer-nature':
      return {
        beforeBody: [String.raw`\documentclass[pdflatex,sn-mathphys-ay]{sn-jnl}`, common, String.raw`\begin{document}`,
          `\\title{${title}}`,
          ...manuscript.authors.map(name => `\\author[1]{\\sur{${name}}}`), !!email && `\\email{${email}}`,
          `\\affil[1]{\\orgname{${affiliation}}}`,
          joinMappedTex([String.raw`\abstract{`, { text: manuscript.abstract, lines: manuscript.lineSources.abstract }, '}'], ''),
          keywords(String.raw`\keywords{`, '}'), String.raw`\maketitle`],
        bibStyle: '', packages: ['sn-jnl.cls', 'sn-mathphys-ay.bst'],
      }

    case 'agu-jgr-atmospheres':
      return {
        beforeBody: [String.raw`\documentclass[draft${lineNumberedDraft ? ',linenumbers' : ''}]{agujournal2025}`, common,
          String.raw`\newcommand{\AguCitation}[4]{\IfNoValueTF{#3}{\IfNoValueTF{#2}{#1{#4}}{#1[#2]{#4}}}{#1<#2>[#3]{#4}}}
\ProvideDocumentCommand{\citep}{o o m}{\AguCitation{\cite}{#1}{#2}{#3}}
\ProvideDocumentCommand{\citet}{o o m}{\AguCitation{\citeA}{#1}{#2}{#3}}
\ProvideDocumentCommand{\citealp}{o o m}{\AguCitation{\citeNP}{#1}{#2}{#3}}
\ProvideDocumentCommand{\citealt}{o o m}{\AguCitation{\citeNP}{#1}{#2}{#3}}`,
          String.raw`\begin{document}`, String.raw`\journalname{Journal of Geophysical Research: Atmospheres}`,
          '\\title{' + title + '}', '\\authors{' + manuscript.authors.map(author => author + '\\affil{1}').join(', ') + '}',
          '\\affiliation{1}{' + affiliation + '}', !!email && '\\authoraddr{' + manuscript.authors[0] + ', ' + email + '}',
          '\\keypoints{' + escape(fields.keyPoint ?? '') + '}{' + escape(fields.keyPoint2 ?? '') + '}{' + escape(fields.keyPoint3 ?? '') + '}', '\\maketitle', '\\begin{abstract}',
          { text: manuscript.abstract, lines: manuscript.lineSources.abstract }, '\\begin{plainlanguagesummary}',
          escape(fields.plainLanguageSummary ?? ''), '\\end{plainlanguagesummary}', '\\end{abstract}',
          keywords('\\noindent\\textbf{Keywords: }', '')],
        afterBody: ['\\section*{Open Research Statement}', escape(fields.openResearch ?? '')],
        bibStyle: '', packages: ['agujournal2025.cls', 'tweaklist-git-moderncv-fixed.sty'],
        artwork: ['agu-logo-large.pdf', 'agu-logo-small.pdf'],
      }
    case 'ieee-compsoc':
      return {
        beforeBody: ['\\documentclass[10pt,journal,compsoc]{IEEEtran}', common, '\\usepackage[numbers,sort&compress]{natbib}',
          '\\begin{document}', `\\title{${title}}`,
          `\\author{${authors}\\IEEEcompsocitemizethanks{\\IEEEcompsocthanksitem ${affiliation}${email ? ` (e-mail: ${email})` : ''}}}`,
          '\\IEEEtitleabstractindextext{', ...abstract, keywords('\\begin{IEEEkeywords}', '\\end{IEEEkeywords}'),
          '}', '\\maketitle', '\\IEEEdisplaynontitleabstractindextext'],
        bibStyle: 'IEEEtran-numeric-natbib', packages: ['IEEEtran.cls', 'IEEEtran.bst'],
      }
  }
}
