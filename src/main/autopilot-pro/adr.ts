import { existsSync, readdirSync } from 'fs'
import { join } from 'path'

const ADR_DIR = 'docs/decisions'

export function nextAdrNumber(projectPath: string): string {
  const dir = join(projectPath, ADR_DIR)
  if (!existsSync(dir)) return '0001'
  const files = readdirSync(dir).filter((f) => /^\d{4}-.*\.md$/.test(f))
  if (files.length === 0) return '0001'
  const max = files.reduce((m, f) => {
    const n = Number(f.slice(0, 4))
    return Number.isFinite(n) && n > m ? n : m
  }, 0)
  return String(max + 1).padStart(4, '0')
}

export function adrSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '')
}

export function buildAdrId(title: string, n: string): string {
  return `${n}-${adrSlug(title)}`
}

export interface ParsedAdr {
  title: string
  status: string
  sections: Record<string, string>
}

export function parseAdr(text: string): ParsedAdr | null {
  const lines = text.split(/\r?\n/)
  let title = ''
  const sections: Record<string, string> = {}
  let currentSection: string | null = null
  let buf: string[] = []

  for (const line of lines) {
    const titleMatch = line.match(/^#\s+(?:ADR-\d+:\s+)?(.+?)\s*$/)
    if (titleMatch && !title) {
      title = titleMatch[1].trim()
      continue
    }
    const sectionMatch = line.match(/^##\s+(.+?)\s*$/)
    if (sectionMatch) {
      if (currentSection) {
        sections[currentSection.toLowerCase()] = buf.join('\n').trim()
      }
      currentSection = sectionMatch[1].trim()
      buf = []
      continue
    }
    if (currentSection) buf.push(line)
  }
  if (currentSection) {
    sections[currentSection.toLowerCase()] = buf.join('\n').trim()
  }

  if (!title) return null
  if (!sections['status']) return null
  if (!sections['context']) return null
  if (!sections['decision']) return null
  if (!sections['consequences']) return null

  return { title, status: sections['status'], sections }
}
