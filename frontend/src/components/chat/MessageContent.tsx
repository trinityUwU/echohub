import { ThinkingBlock } from './ThinkingBlock'
import type { ContentPart } from '@/types'

interface Props {
  content: string | ContentPart[]
  streaming?: boolean
}

function parseThinking(text: string): { thinking: string | null; rest: string; thinkingStreaming: boolean } {
  const openTag = '<think>'
  const closeTag = '</think>'
  const openIdx = text.indexOf(openTag)
  if (openIdx === -1) return { thinking: null, rest: text, thinkingStreaming: false }

  const afterOpen = openIdx + openTag.length
  const closeIdx = text.indexOf(closeTag, afterOpen)

  if (closeIdx === -1) {
    return { thinking: text.slice(afterOpen), rest: text.slice(0, openIdx), thinkingStreaming: true }
  }

  const thinkContent = text.slice(afterOpen, closeIdx)
  const rest = text.slice(0, openIdx) + text.slice(closeIdx + closeTag.length)
  return { thinking: thinkContent, rest, thinkingStreaming: false }
}

function renderMarkdown(text: string): React.ReactNode[] {
  const elements: React.ReactNode[] = []
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      elements.push(...renderInline(text.slice(lastIndex, match.index), key))
      key += 100
    }
    elements.push(
      <pre key={`code-${key++}`} className="bg-surface-2 rounded-lg p-3 my-2 overflow-x-auto">
        <code className="text-xs font-mono text-white/80">{match[2]}</code>
      </pre>
    )
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    elements.push(...renderInline(text.slice(lastIndex), key))
  }

  return elements
}

function renderInline(text: string, startKey: number): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const paragraphs = text.split(/\n\n+/)
  let key = startKey

  for (const para of paragraphs) {
    if (!para.trim()) continue
    const lines = para.split('\n')
    const lineNodes: React.ReactNode[] = []

    for (const line of lines) {
      if (line.startsWith('# ')) {
        lineNodes.push(<h4 key={key++} className="font-semibold text-sm mt-2 mb-1">{processInline(line.slice(2))}</h4>)
      } else if (line.startsWith('## ')) {
        lineNodes.push(<h5 key={key++} className="font-medium text-sm mt-2 mb-1">{processInline(line.slice(3))}</h5>)
      } else {
        lineNodes.push(<span key={key++}>{processInline(line)}{'\n'}</span>)
      }
    }

    parts.push(<p key={`p-${key++}`} className="mb-3 last:mb-0">{lineNodes}</p>)
  }

  return parts
}

function processInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g
  let lastIdx = 0
  let match: RegExpExecArray | null
  let k = 0

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index))
    if (match[2]) parts.push(<strong key={`b-${k++}`}>{match[2]}</strong>)
    else if (match[3]) parts.push(<em key={`i-${k++}`}>{match[3]}</em>)
    else if (match[4]) parts.push(<code key={`c-${k++}`} className="bg-surface-3 px-1 py-0.5 rounded text-2xs font-mono">{match[4]}</code>)
    lastIdx = match.index + match[0].length
  }

  if (lastIdx < text.length) parts.push(text.slice(lastIdx))
  return parts.length === 1 ? parts[0] : <>{parts}</>
}

export function MessageContent({ content, streaming }: Props) {
  let textContent: string

  if (Array.isArray(content)) {
    const images = content.filter(p => p.type === 'image_url')
    const texts = content.filter(p => p.type === 'text')
    textContent = texts.map(p => p.type === 'text' ? p.text : '').join('\n')

    const { thinking, rest, thinkingStreaming } = parseThinking(textContent)

    return (
      <div className="space-y-2">
        {images.map((img, i) => (
          img.type === 'image_url' && (
            <img key={i} src={img.image_url.url} alt="" className="max-h-48 rounded-lg object-contain" />
          )
        ))}
        {thinking && <ThinkingBlock content={thinking} streaming={streaming && thinkingStreaming} />}
        <div className="text-sm leading-relaxed whitespace-pre-wrap">{renderMarkdown(rest)}</div>
      </div>
    )
  }

  textContent = content
  const { thinking, rest, thinkingStreaming } = parseThinking(textContent)

  return (
    <div className="space-y-1">
      {thinking && <ThinkingBlock content={thinking} streaming={streaming && thinkingStreaming} />}
      <div className="text-sm leading-relaxed whitespace-pre-wrap">{renderMarkdown(rest)}</div>
    </div>
  )
}
