// Resolution of file paths clicked in a terminal. A path printed by a CLI is
// frequently relative to the terminal's working directory ("docs/NOTES.md",
// "src/main.ts:12:5"); anything not absolute must be joined onto the
// terminal's folder before the main process can read or open it — the main
// process resolves paths against the app's cwd, not the terminal's.

// Absolute forms: "C:\x" / "C:/x" (drive), "\\server\share" (UNC), and a
// leading slash or backslash (POSIX absolute / Windows drive-relative —
// either way, never something to join onto the project folder).
const ABSOLUTE_RE = /^([a-zA-Z]:[\\/]|[\\/])/

/**
 * Strip a trailing :line[:col] suffix and make the path absolute, joining a
 * relative path onto the terminal's folder.
 *
 * Interior . and .. segments are collapsed so the result is a clean path rather
 * than something like C:\proj\..\..\notes.md. This runs in the renderer as well as
 * the main process, so node's path module is not available and the walk is done
 * by hand.
 */
export function resolveTerminalPath(raw: string, folderPath: string, platform: string): string {
  const filePart = raw.replace(/:\d+(:\d+)?$/, '')
  const sep = platform === 'win32' ? '\\' : '/'
  const joined = ABSOLUTE_RE.test(filePart) ? filePart : folderPath + sep + filePart
  // Only rewrite when there is actually a . or .. segment to collapse. Callers
  // and existing tests rely on separators surviving verbatim — a CLI printing
  // docs/a.md under a Windows folder yields D:\proj\docs/a.md, and Windows
  // accepts the mix. Normalising unconditionally would rewrite those too.
  return hasDotSegment(joined) ? normalizeSegments(joined, sep) : joined
}

/** True when the path contains a . or .. segment worth collapsing. */
function hasDotSegment(p: string): boolean {
  return /(?:^|[\\/])\.{1,2}(?:[\\/]|$)/.test(p)
}

/**
 * Collapse . and .. segments. The root (a drive prefix, POSIX /, or a UNC
 * prefix) is preserved verbatim, and a .. that would climb past it is
 * dropped rather than escaping it.
 */
function normalizeSegments(input: string, sep: string): string {
  const leading = /^([a-zA-Z]:[\\\\/]|[\\\\/]+)/.exec(input)?.[0] ?? ''
  const body = input.slice(leading.length)
  const out: string[] = []
  for (const part of body.split(/[\\\\/]+/)) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      const last = out[out.length - 1]
      // Keep a .. that has nothing to pop only when there is no root to climb
      // past; with a root it is meaningless and dropping it is the safe read.
      if (out.length > 0 && last !== '..') out.pop()
      else if (!leading) out.push('..')
      continue
    }
    out.push(part)
  }
  return leading + out.join(sep)
}

// Detection of clickable path-shaped runs in a line of terminal output.
// Branches, in order: file:// URLs; Windows drive paths in either slash style
// (the lookbehind stops the "s://" tail of an http URL matching as a drive);
// POSIX absolute paths not inside a URL; relative paths containing a
// separator; and bare filenames with a known extension. Each accepts an
// optional trailing :line[:col].
// & is included in the path character classes: directory names like "R&D" are
// ordinary, and excluding it split such a path into two bogus matches that then
// failed the existsSync check. Safe only because spawnEditor now builds and
// quotes its own command line - an unquoted & reaching cmd.exe would read as a
// command separator.
const TERMINAL_PATH_SOURCE =
  "file:\\/\\/[^\\s'\"<>|)\\]]+" +
  '|(?<![\\w.])[A-Za-z]:[\\\\/][\\w&\\\\/.-]+(?::\\d+(?::\\d+)?)?' +
  '|(?<!\\/)\\/[\\w&./-]+(?::\\d+(?::\\d+)?)?' +
  '|(?:\\.[\\\\/]|\\.\\.[\\\\/]|[\\w][\\w&/\\\\.-]*[\\\\/][\\w&.-]+)(?::\\d+(?::\\d+)?)?' +
  '|[\\w.-]+\\.(?:md|ts|tsx|js|jsx|json|yaml|yml|toml|css|html|py|rs|go|java|sh|sql|xml|csv|txt|log|env|cfg|ini|conf)(?::\\d+(?::\\d+)?)?'

// No path a person clicks is longer than this. The alternation above
// backtracks quadratically on long word/dot runs that never match (a JWT, a
// hash, a base64 blob printed by a CLI): every start position re-scans the
// whole tail. On a multi-thousand-char wrapped line that turned each hover
// into seconds-to-minutes of regex work and froze the renderer, so tokens
// beyond this cap never reach the regex at all.
export const MAX_PATH_TOKEN_LENGTH = 512

/** Find path-shaped runs in a line of terminal output. Returns each match with
 *  its start index so callers can map back to buffer coordinates. A fresh
 *  regex per call keeps the /g lastIndex from leaking between lines. */
export function findTerminalPaths(text: string): Array<{ index: number; text: string }> {
  const re = new RegExp(`(?:${TERMINAL_PATH_SOURCE})`, 'gi')
  const out: Array<{ index: number; text: string }> = []
  // Every branch of the pattern matches a whitespace-free run, so scanning
  // token by token is behavior-preserving — and it bounds the backtracking
  // worst case to one token's length instead of the whole line's.
  const tokenRe = /\S+/g
  let token: RegExpExecArray | null
  while ((token = tokenRe.exec(text)) !== null) {
    if (token[0].length > MAX_PATH_TOKEN_LENGTH) continue
    re.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(token[0])) !== null) {
      out.push({ index: token.index + match.index, text: match[0] })
    }
  }
  return out
}
