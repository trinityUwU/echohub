import { ThinkingBlock } from './ThinkingBlock'
import { MarkdownContent } from './MarkdownContent'

interface Props {
  content: string
  streaming?: boolean
}

interface Segment {
  type: 'thinking' | 'text'
  content: string
}

function parseContent(raw: string): Segment[] {
  const segments: Segment[] = []
  let remaining = raw

  while (remaining.length > 0) {
    const start = remaining.indexOf('<think>')
    if (start === -1) {
      if (remaining.trim()) segments.push({ type: 'text', content: remaining })
      break
    }
    // text before <think>
    if (start > 0) {
      const before = remaining.slice(0, start)
      if (before.trim()) segments.push({ type: 'text', content: before })
    }
    const end = remaining.indexOf('</think>', start)
    if (end === -1) {
      // Still streaming — unclosed tag
      const thinkContent = remaining.slice(start + 7)
      segments.push({ type: 'thinking', content: thinkContent })
      break
    }
    const thinkContent = remaining.slice(start + 7, end)
    segments.push({ type: 'thinking', content: thinkContent })
    remaining = remaining.slice(end + 8)
  }

  return segments
}

export function MessageContent({ content, streaming }: Props) {
  const segments = parseContent(content)
  const isThinkingOnly = segments.length === 1 && segments[0].type === 'thinking'

  return (
    <div>
      {segments.map((seg, i) => {
        if (seg.type === 'thinking') {
          return (
            <ThinkingBlock
              key={i}
              content={seg.content.trim()}
              streaming={streaming && isThinkingOnly}
            />
          )
        }
        const isLast = i === segments.length - 1
        return (
          <MarkdownContent
            key={i}
            content={seg.content}
            streaming={streaming && isLast}
          />
        )
      })}
    </div>
  )
}
