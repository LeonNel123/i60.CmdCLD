import type { DoerMarker } from './types'
import {
  findLastMarker,
  parseTerminalMarkerLine,
  splitTerminalLines,
  stripTerminalAnsi,
} from './pty-watcher'

export interface AutopilotOutputInspection {
  rawChars: number
  cleanChars: number
  cleanTail: string
  marker: DoerMarker | null
  markerLine: string | null
  structuredFields: Record<string, string>
  summary: string
}

const DEFAULT_TAIL_CHARS = 4000

function parseStructuredSegments(line: string): Array<{ key: string; val: string }> {
  const matches = Array.from(line.matchAll(/([A-Z_]+):\s*/g))
  return matches.map((match, idx) => {
    const key = match[1]
    const valueStart = (match.index ?? 0) + match[0].length
    const valueEnd = idx + 1 < matches.length ? matches[idx + 1].index ?? line.length : line.length
    return { key, val: line.slice(valueStart, valueEnd).trim() }
  })
}

function extractStructuredFields(cleaned: string, markerLine: string | null): Record<string, string> {
  if (!markerLine) return {}
  const lines = splitTerminalLines(cleaned)
  let markerIndex = -1
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i] === markerLine) {
      markerIndex = i
      break
    }
    if (markerIndex < 0 && parseTerminalMarkerLine(lines[i])) {
      markerIndex = i
    }
  }
  if (markerIndex < 0) return {}

  const fields: Record<string, string> = {}
  const markerTail = parseTerminalMarkerLine(lines[markerIndex])?.tail ?? ''
  const fieldLines = markerTail.includes(':')
    ? [markerTail, ...lines.slice(markerIndex + 1)]
    : lines.slice(markerIndex + 1)
  for (const line of fieldLines) {
    for (const segment of parseStructuredSegments(line)) {
      fields[segment.key] = segment.val
    }
  }
  return fields
}

export function inspectAutopilotOutput(text: string, tailChars = DEFAULT_TAIL_CHARS): AutopilotOutputInspection {
  const cleaned = stripTerminalAnsi(text)
  const found = findLastMarker(text)
  const marker = found?.marker ?? null
  const markerLine = marker?.raw ?? null
  const structuredFields = extractStructuredFields(cleaned, markerLine)
  const cleanTail = cleaned.slice(-tailChars)

  return {
    rawChars: text.length,
    cleanChars: cleaned.length,
    cleanTail,
    marker,
    markerLine,
    structuredFields,
    summary: marker
      ? `Parser-visible marker: ${marker.kind}${marker.question ? ` (${marker.question})` : marker.text ? ` (${marker.text})` : ''}`
      : 'No parser-visible [ORCH:*] marker was found in terminal scrollback.',
  }
}
