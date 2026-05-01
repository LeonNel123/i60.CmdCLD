export interface ParsedResearch {
  slug: string
  created: string
  lastVerified: string
  sources: string[]
  title: string
  sections: Record<string, string>
}

export function researchSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
}

export function parseResearchSummary(text: string): ParsedResearch | null {
  const fmMatch = text.match(/^---\r?\n([\s\S]+?)\r?\n---\r?\n([\s\S]*)$/)
  if (!fmMatch) return null
  const fmBody = fmMatch[1]
  const rest = fmMatch[2]

  const fm = parseFrontmatter(fmBody)
  if (!fm.slug || typeof fm.slug !== 'string') return null
  if (!fm.created || typeof fm.created !== 'string') return null
  if (!Array.isArray(fm.sources) || fm.sources.length === 0) return null

  const lines = rest.split(/\r?\n/)
  let title = ''
  const sections: Record<string, string> = {}
  let currentSection: string | null = null
  let buf: string[] = []

  for (const line of lines) {
    const titleMatch = line.match(/^#\s+(.+?)\s*$/)
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
  if (!sections['question']) return null
  if (!sections['findings']) return null
  if (!sections['implications for this project']) return null

  return {
    slug: String(fm.slug),
    created: String(fm.created),
    lastVerified: String(fm['last-verified'] ?? fm.created),
    sources: (fm.sources as unknown[]).map((s) => String(s)),
    title,
    sections,
  }
}

function parseFrontmatter(body: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = body.split(/\r?\n/)
  let currentKey: string | null = null
  let currentList: string[] | null = null

  for (const line of lines) {
    const listItem = line.match(/^\s+-\s+(.+)$/)
    if (listItem && currentList) {
      currentList.push(listItem[1].trim())
      continue
    }
    const kv = line.match(/^([\w-]+):\s*(.*)$/)
    if (!kv) continue
    const key = kv[1]
    const value = kv[2].trim()
    currentKey = key
    if (value === '' || value === '[]') {
      // start of a list, or explicit empty list
      currentList = []
      result[key] = currentList
    } else {
      currentList = null
      result[key] = value
    }
  }
  // Drop empty arrays so callers see `sources: []` as undefined-ish
  for (const k of Object.keys(result)) {
    if (Array.isArray(result[k]) && (result[k] as unknown[]).length === 0) {
      delete result[k]
    }
  }
  return result
}
