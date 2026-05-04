import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, isAbsolute, relative, resolve } from 'path'
import { COUNCIL_DIR } from './types'

export function councilPath(projectPath: string, relativePath: string): string {
  if (relativePath.split(/[\\/]+/).includes('..')) {
    throw new Error(`Council path cannot traverse outside ${COUNCIL_DIR}`)
  }

  const councilDir = resolve(projectPath, COUNCIL_DIR)
  const path = resolve(councilDir, relativePath)
  const pathRelativeToCouncilDir = relative(councilDir, path)

  if (pathRelativeToCouncilDir.startsWith('..') || isAbsolute(pathRelativeToCouncilDir)) {
    throw new Error(`Council path must stay inside ${COUNCIL_DIR}`)
  }

  return path
}

export function writeCouncilFile(projectPath: string, relativePath: string, content: string): void {
  const path = councilPath(projectPath, relativePath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

export function readCouncilFile(projectPath: string, relativePath: string): string | null {
  try {
    return readFileSync(councilPath(projectPath, relativePath), 'utf-8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return null
    throw error
  }
}

export function appendCouncilDecision(projectPath: string, text: string): void {
  const path = councilPath(projectPath, 'decisions.md')
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `- ${new Date().toISOString()} ${text}\n`)
}

export function readRecentCouncilDecisions(projectPath: string, limit = 8): string[] {
  const content = readCouncilFile(projectPath, 'decisions.md')
  if (content === null) return []

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-limit)
}

export function writeReviewPacketFiles(
  projectPath: string,
  packetId: string,
  requestMarkdown: string,
  responseJson: string,
): void {
  writeCouncilFile(projectPath, `packets/${packetId}.request.md`, requestMarkdown)
  writeCouncilFile(projectPath, `packets/${packetId}.response.json`, responseJson)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
