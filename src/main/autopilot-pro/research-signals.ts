export interface ResearchSignals {
  triggerReason: string
  urls: string[]
  repos: string[]
  keywords: string[]
  comparisons: string[]
}

const URL_RE = /https?:\/\/[^\s)>"']+/g
const REPO_RE = /\b([\w][\w-]*)\/([\w][\w.-]*?)(?=\.git\b|\/(?:blob|tree|issues|pulls|releases)\b)/g
const KEYWORDS = ['research', 'investigate', 'compare', 'evaluate', 'survey', 'study', 'analyze']
const KEYWORD_RE = new RegExp(`\\b(?:${KEYWORDS.join('|')})\\b`, 'gi')
const COMPARISON_RE = /\b([\w-]+)\s+(?:vs\.?|versus)\s+([\w-]+)\b/gi

export function detectResearchSignals(idea: string): ResearchSignals | null {
  if (!idea || typeof idea !== 'string') return null

  const urls: string[] = []
  let m: RegExpExecArray | null
  URL_RE.lastIndex = 0
  while ((m = URL_RE.exec(idea)) !== null) {
    urls.push(m[0])
  }

  // Strip URLs before repo detection so paths inside URLs don't leak in
  const ideaWithoutUrls = idea.replace(URL_RE, ' ')

  const repos: string[] = []
  REPO_RE.lastIndex = 0
  while ((m = REPO_RE.exec(ideaWithoutUrls)) !== null) {
    repos.push(`${m[1]}/${m[2]}`)
  }

  const keywords: string[] = []
  KEYWORD_RE.lastIndex = 0
  while ((m = KEYWORD_RE.exec(idea)) !== null) {
    const kw = m[0].toLowerCase()
    if (!keywords.includes(kw)) keywords.push(kw)
  }

  const comparisons: string[] = []
  COMPARISON_RE.lastIndex = 0
  while ((m = COMPARISON_RE.exec(idea)) !== null) {
    comparisons.push(`${m[1]} vs ${m[2]}`)
  }

  if (urls.length === 0 && repos.length === 0 && keywords.length === 0 && comparisons.length === 0) {
    return null
  }

  return {
    triggerReason: 'auto-detected from freeTextIdea',
    urls,
    repos,
    keywords,
    comparisons,
  }
}
