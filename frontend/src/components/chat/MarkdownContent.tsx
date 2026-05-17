import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { Components } from 'react-markdown'

interface MarkdownContentProps { content: string }

const components: Components = {
  // ── Headings ──────────────────────────────────────────────────────────────
  h1: ({ children }) => (
    <h1 className="text-lg font-bold text-text-primary mt-5 mb-2 pb-1.5 border-b border-border/60 first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-base font-semibold text-text-primary mt-4 mb-2 first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold text-text-primary mt-3 mb-1.5 first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-sm font-medium text-text-secondary mt-3 mb-1 first:mt-0">
      {children}
    </h4>
  ),

  // ── Paragraphs ────────────────────────────────────────────────────────────
  p: ({ children }) => (
    <p className="text-sm text-text-primary leading-relaxed mb-3 last:mb-0">
      {children}
    </p>
  ),

  // ── Code ──────────────────────────────────────────────────────────────────
  code({ className, children, ...props }) {
    const lang = className?.replace('language-', '') ?? ''
    const isBlock = !!className?.includes('language-')

    if (!isBlock) {
      return (
        <code
          className="font-mono text-[0.8em] bg-white/8 text-accent/90 px-1.5 py-0.5 rounded-sm border border-white/8"
          {...props}
        >
          {children}
        </code>
      )
    }

    return (
      <div className="my-3 rounded-md overflow-hidden border border-border/60">
        {lang && (
          <div className="flex items-center justify-between px-3 py-1.5 bg-elevated border-b border-border/40">
            <span className="text-2xs font-mono text-text-muted uppercase tracking-widest">{lang}</span>
          </div>
        )}
        <pre className="bg-[#0a0a0d] p-3.5 font-mono text-xs leading-relaxed overflow-x-auto m-0">
          <code className={className} {...props}>{children}</code>
        </pre>
      </div>
    )
  },

  // ── Lists ─────────────────────────────────────────────────────────────────
  ul: ({ children }) => (
    <ul className="text-sm text-text-primary mb-3 last:mb-0 space-y-1 pl-0 list-none">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="text-sm text-text-primary mb-3 last:mb-0 space-y-1 pl-0 list-none counter-reset-[item]">
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => {
    const isOrdered = (props as { ordered?: boolean }).ordered
    return (
      <li className="flex gap-2.5 items-baseline leading-relaxed">
        {isOrdered
          ? <span className="text-accent/70 font-mono text-xs flex-shrink-0 min-w-[1.25rem] text-right" />
          : <span className="text-accent/70 mt-1.5 flex-shrink-0 text-xs">▸</span>
        }
        <span>{children}</span>
      </li>
    )
  },

  // ── Blockquote ────────────────────────────────────────────────────────────
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-accent/40 pl-3.5 my-3 text-text-secondary italic text-sm">
      {children}
    </blockquote>
  ),

  // ── Table ─────────────────────────────────────────────────────────────────
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-md border border-border/60">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-elevated text-text-secondary text-xs uppercase tracking-widest">
      {children}
    </thead>
  ),
  th: ({ children }) => (
    <th className="px-3 py-2 text-left font-semibold border-b border-border/60">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 border-b border-border/30 text-text-primary">{children}</td>
  ),

  // ── Horizontal rule ───────────────────────────────────────────────────────
  hr: () => <hr className="border-none border-t border-border/40 my-4" />,

  // ── Inline ────────────────────────────────────────────────────────────────
  strong: ({ children }) => (
    <strong className="font-semibold text-text-primary">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="italic text-text-secondary">{children}</em>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="text-accent hover:text-accent-hover underline underline-offset-2 decoration-accent/40 transition-colors">
      {children}
    </a>
  ),
}

export function MarkdownContent({ content }: MarkdownContentProps): React.ReactElement {
  return (
    <div className="min-w-0 w-full">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
