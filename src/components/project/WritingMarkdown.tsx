'use client'

import { createContext, useContext, type ComponentProps } from 'react'
import Markdown, { type Components, type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Element, Root, RootContent, Text } from 'hast'
import type { InlineEvidenceTarget } from '@/lib/project/writing-ai-evidence'

const components: Components = {
  table: ({ children }) => <div tabIndex={0} role="region" aria-label="Markdown table"
    className="max-w-full overflow-x-auto rounded-md border border-slate-200">
    <table className="w-full border-collapse text-xs">{children}</table>
  </div>,
  pre: ({ children }) => <pre tabIndex={0}
    className="max-w-full overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
    {children}
  </pre>,
  a: ({ href, title, children }) => {
    if (!href) return <span>{children}</span>
    const external = /^https?:\/\//i.test(href)
    return <a href={href} title={title} target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined} className="text-indigo-700 underline">{children}</a>
  },
  img: ({ alt }) => alt ? <span>{alt}</span> : null,
  button: EvidenceButton,
}

function writingUrl(url: string) {
  return /^(?:https?:\/\/[^/\s]|mailto:[^\s]|#)/i.test(url) ? url : undefined
}

function markEvidence(targets: ReadonlyMap<string, InlineEvidenceTarget>) {
  const labels = [...targets.keys()].sort((a, b) => b.length - a.length)
  const escaped = labels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const mentions = new RegExp(`(?<![\\w./@-])(?:${escaped})(?![\\w/:-])`, 'g')
  return () => (tree: Root) => {
    function visit<T extends RootContent>(children: T[], code = false): (T | Text | Element)[] {
      return children.flatMap<T | Text | Element>(child => {
        if (child.type === 'element' && !['a', 'pre', 'button'].includes(child.tagName)) {
          child.children = visit(child.children, code || child.tagName === 'code')
        }
        if (child.type !== 'text') return [child]
        const parts: (Text | Element)[] = []
        let offset = 0
        for (const match of child.value.matchAll(mentions)) {
          const label = match[0]
          if (!code && !label.startsWith('@') && !/:\d+$/.test(label)) continue
          const start = match.index ?? 0
          if (start > offset) parts.push({ type: 'text', value: child.value.slice(offset, start) })
          parts.push({ type: 'element', tagName: 'button', properties: { dataEvidence: label },
            children: [{ type: 'text', value: label }] })
          offset = start + label.length
        }
        if (!parts.length) return [child]
        if (offset < child.value.length) parts.push({ type: 'text', value: child.value.slice(offset) })
        return parts
      })
    }
    tree.children = visit(tree.children)
  }
}

type EvidenceActions = {
  targets: ReadonlyMap<string, InlineEvidenceTarget>
  onLocate: (path: string, line: number) => void
  onRefresh: (path: string) => void
}

const EvidenceContext = createContext<EvidenceActions | undefined>(undefined)

function EvidenceButton({ node, children }: ComponentProps<'button'> & ExtraProps) {
  const evidence = useContext(EvidenceContext)
  const label = node?.properties.dataEvidence
  const target = typeof label === 'string' ? evidence?.targets.get(label) : undefined
  if (!target || !evidence) return <span>{children}</span>
  const { location } = target
  const title = location ? `Open ${location.path}:${location.line}` : `Find fresh evidence for ${label}`
  return <button type="button" title={title} aria-label={title}
    className={location ? 'text-left text-indigo-700 underline' : 'text-left text-amber-800 underline decoration-dashed'}
    onClick={() => location ? evidence.onLocate(location.path, location.line) : evidence.onRefresh(target.path)}>{children}</button>
}

export function WritingMarkdown({ text, evidence }: { text: string; evidence?: EvidenceActions }) {
  if (!text.trim()) return null
  return <div className="min-w-0 space-y-2 [overflow-wrap:anywhere]
    [&_:is(h1,h2,h3,h4,h5,h6)]:font-semibold [&_:is(h1,h2)]:text-base
    [&_p]:whitespace-pre-line [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3
    [&_ol]:list-decimal [&_ul]:list-disc [&_:is(ol,ul)]:space-y-1 [&_:is(ol,ul)]:pl-5
    [&_.task-list-item]:list-none [&_input]:mr-1
    [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-0.5 [&_code]:text-xs
    [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:[overflow-wrap:normal]
    [&_th]:bg-slate-50 [&_:is(th,td)]:min-w-24 [&_:is(th,td)]:border-b [&_:is(th,td)]:border-slate-200
    [&_:is(th,td)]:px-2 [&_:is(th,td)]:py-1.5 [&_:is(th,td)]:align-top">
    <EvidenceContext.Provider value={evidence}>
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={evidence?.targets.size ? [markEvidence(evidence.targets)] : []}
        components={components} urlTransform={writingUrl} skipHtml>{text}</Markdown>
    </EvidenceContext.Provider>
  </div>
}
