import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

interface MarkdownContentProps { content: string }

export function MarkdownContent({ content }: MarkdownContentProps): React.ReactElement {
  return (
    <div className="prose prose-invert prose-sm max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          code({ className, children, ...props }) {
            const isBlock = className?.includes('language-')
            if (!isBlock) {
              return (
                <code className="font-mono text-xs bg-white/7 px-1 py-0.5 rounded-sm" {...props}>
                  {children}
                </code>
              )
            }
            return (
              <pre className="bg-[#0d0d10] border border-border rounded-sm p-3 font-mono text-xs overflow-x-auto my-2 leading-relaxed">
                <code className={className} {...props}>{children}</code>
              </pre>
            )
          },
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic text-text-secondary">{children}</em>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
