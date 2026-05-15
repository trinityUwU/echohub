import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark.css'

interface Props {
  content: string
  streaming?: boolean
}

export function MarkdownContent({ content, streaming }: Props) {
  return (
    <div className="prose-echohub">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // Headings
          h1: ({ children }) => (
            <h1 className="text-lg font-semibold text-white mt-5 mb-3 first:mt-0 leading-snug">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-base font-semibold text-white mt-4 mb-2 first:mt-0 leading-snug">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-semibold text-white/90 mt-3 mb-1.5 first:mt-0">{children}</h3>
          ),

          // Paragraphs
          p: ({ children }) => (
            <p className="text-sm text-white/90 leading-relaxed mb-3 last:mb-0">{children}</p>
          ),

          // Lists
          ul: ({ children }) => (
            <ul className="mb-3 space-y-1 pl-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-3 space-y-1 pl-1 list-decimal list-inside">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="text-sm text-white/90 leading-relaxed flex gap-2 items-start">
              <span className="text-accent mt-1.5 shrink-0 text-xs">•</span>
              <span>{children}</span>
            </li>
          ),

          // Inline code
          code: ({ children, className }) => {
            const isBlock = className?.startsWith('language-')
            if (isBlock) {
              return <code className={className}>{children}</code>
            }
            return (
              <code className="px-1.5 py-0.5 rounded-md bg-white/10 text-[0.8em] font-mono text-violet-200 border border-white/10">
                {children}
              </code>
            )
          },

          // Code blocks
          pre: ({ children }) => (
            <div className="relative group my-3">
              <pre className="rounded-xl bg-black/40 border border-white/10 p-4 overflow-x-auto text-xs leading-relaxed font-mono">
                {children}
              </pre>
            </div>
          ),

          // Blockquote
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-accent/50 pl-4 my-3 text-white/60 italic text-sm">
              {children}
            </blockquote>
          ),

          // Links
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline decoration-accent/30 hover:decoration-accent transition-colors"
            >
              {children}
            </a>
          ),

          // Tables
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-surface-3 border-b border-border">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="px-4 py-2 text-left text-xs font-semibold text-white/70 uppercase tracking-wide">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-4 py-2.5 text-sm text-white/80 border-t border-border/50">{children}</td>
          ),

          // HR
          hr: () => <hr className="my-4 border-border" />,

          // Strong / Em
          strong: ({ children }) => (
            <strong className="font-semibold text-white">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic text-white/80">{children}</em>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
      {streaming && (
        <span className="inline-block w-1.5 h-4 bg-white/70 ml-0.5 animate-pulse align-middle" />
      )}
    </div>
  )
}
