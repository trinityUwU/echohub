import { ThinkingBlock } from './ThinkingBlock'
import { MarkdownContent } from './MarkdownContent'
import { ToolCallBlock, ToolResultBlock } from './ToolBlocks'
import type { AgentStep } from '@/types'

interface Props {
  content: string
  streaming?: boolean
  agentStepsMap?: Record<string, AgentStep[]>
}

type Segment =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string; open: boolean }
  | { type: 'tool_call'; content: string; open: boolean }
  | { type: 'tool_result'; tool: string; content: string }

function parseSegments(content: string): Segment[] {
  const segments: Segment[] = []
  let remaining = content
  let inThink = false
  let inToolCall = false
  let inToolResult = false
  let buffer = ''

  const push = (type: Segment['type'], extra?: object) => {
    if (buffer || extra) {
      segments.push({ type, content: buffer, ...extra } as Segment)
      buffer = ''
    }
  }

  while (remaining.length > 0) {
    if (!inThink && !inToolCall && !inToolResult) {
      const thinkOpen = remaining.indexOf('<think>')
      const thinkClose = remaining.indexOf('</think>')  // orphan close — Qwen3 omits opening tag
      const tcOpen = remaining.indexOf('<tool_call>')
      const trOpen = remaining.indexOf('<tool_result')

      const candidates = [
        thinkOpen >= 0 ? thinkOpen : Infinity,
        // treat orphan </think> as an implicit <think> opened at position 0
        thinkClose >= 0 && (thinkOpen < 0 || thinkClose < thinkOpen) ? thinkClose : Infinity,
        tcOpen >= 0 ? tcOpen : Infinity,
        trOpen >= 0 ? trOpen : Infinity,
      ]
      const first = Math.min(...candidates)

      if (first === Infinity) {
        buffer += remaining
        remaining = ''
        continue
      }

      buffer += remaining.slice(0, first)

      // Orphan </think> — treat everything before it as implicit thinking content
      if (first === thinkClose && (thinkOpen < 0 || thinkClose < thinkOpen)) {
        push('text')
        segments.push({ type: 'thinking', content: buffer || remaining.slice(0, thinkClose), open: false })
        buffer = ''
        remaining = remaining.slice(thinkClose + '</think>'.length)
        continue
      }

      if (first === thinkOpen) {
        push('text')
        inThink = true
        remaining = remaining.slice(first + '<think>'.length)
      } else if (first === tcOpen) {
        push('text')
        inToolCall = true
        remaining = remaining.slice(first + '<tool_call>'.length)
      } else {
        push('text')
        inToolResult = true
        const toolMatch = remaining.slice(first).match(/^<tool_result tool="([^"]*)"[^>]*>/)
        const toolName = toolMatch ? toolMatch[1] : ''
        remaining = remaining.slice(first + (toolMatch ? toolMatch[0].length : '<tool_result>'.length))
        buffer = ''
        const closeIdx = remaining.indexOf('</tool_result>')
        if (closeIdx >= 0) {
          segments.push({ type: 'tool_result', tool: toolName, content: remaining.slice(0, closeIdx) })
          remaining = remaining.slice(closeIdx + '</tool_result>'.length)
          buffer = ''
          inToolResult = false
        } else {
          buffer += remaining
          remaining = ''
        }
        continue
      }
    } else if (inThink) {
      const closeIdx = remaining.indexOf('</think>')
      if (closeIdx >= 0) {
        buffer += remaining.slice(0, closeIdx)
        push('thinking', { open: false })
        inThink = false
        remaining = remaining.slice(closeIdx + '</think>'.length)
      } else {
        buffer += remaining
        segments.push({ type: 'thinking', content: buffer, open: true })
        buffer = ''
        remaining = ''
        inThink = false
      }
    } else if (inToolCall) {
      const closeIdx = remaining.indexOf('</tool_call>')
      if (closeIdx >= 0) {
        buffer += remaining.slice(0, closeIdx)
        push('tool_call', { open: false })
        inToolCall = false
        remaining = remaining.slice(closeIdx + '</tool_call>'.length)
      } else {
        buffer += remaining
        segments.push({ type: 'tool_call', content: buffer, open: true })
        buffer = ''
        remaining = ''
        inToolCall = false
      }
    }
  }

  if (buffer) push('text')
  return segments
}

export function MessageContent({ content, streaming, agentStepsMap }: Props): React.ReactElement {
  const segments = parseSegments(content)

  return (
    <div>
      {segments.map((seg, i) => {
        const isLastSeg = i === segments.length - 1

        if (seg.type === 'thinking') {
          return (
            <ThinkingBlock key={i} content={seg.content.trim()} streaming={streaming && seg.open} />
          )
        }

        if (seg.type === 'tool_call') {
          const nameMatch = seg.content.match(/"name"\s*:\s*"([^"]+)"/)
          const toolName = nameMatch ? nameMatch[1] : ''
          const liveSteps = toolName && agentStepsMap ? (agentStepsMap[toolName] ?? []) : []
          return (
            <ToolCallBlock
              key={i}
              content={seg.content}
              streaming={streaming && seg.open}
              agentSteps={liveSteps}
            />
          )
        }

        if (seg.type === 'tool_result') {
          return <ToolResultBlock key={i} tool={seg.tool} content={seg.content} />
        }

        const trimmed = seg.content.trim()
        if (!trimmed) return null
        return (
          <MarkdownContent key={i} content={seg.content} streaming={streaming && isLastSeg} />
        )
      })}
    </div>
  )
}
