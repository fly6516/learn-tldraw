import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

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
}

function writingUrl(url: string) {
  return /^(?:https?:\/\/[^/\s]|mailto:[^\s]|#)/i.test(url) ? url : undefined
}

export function WritingMarkdown({ text }: { text: string }) {
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
    <Markdown remarkPlugins={[remarkGfm]} components={components} urlTransform={writingUrl} skipHtml>{text}</Markdown>
  </div>
}
