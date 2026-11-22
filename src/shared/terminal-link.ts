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
export function resolveTerminalPath(raw: string, folderPath: string, platform: string, homeDir?: string): string {
  const filePart = raw.replace(/:\d+(:\d+)?$/, '')
  const sep = platform === 'win32' ? '\\' : '/'
  // "~/Documents/x.csv": the shell's home folder, when the caller knows it.
  const underHome = homeDir && /^~[\\/]/.test(filePart) ? homeDir + sep + filePart.slice(2) : null
  const joined = underHome ?? (ABSOLUTE_RE.test(filePart) ? filePart : folderPath + sep + filePart)
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
//
// Extensions that make a bare filename (no folder in front) a link. Source
// files, plus what an agent is asked to produce: spreadsheets, documents,
// PDFs, images. The list is followed by a boundary — without one the first
// alternative that is a prefix won, and "foo.tsx" linked "foo.ts".
const BARE_FILE_EXTS =
  'md|ts|tsx|js|jsx|json|yaml|yml|toml|css|html|py|rs|go|java|sh|sql|xml|csv|tsv|txt|log|env|cfg|ini|conf' +
  '|xlsx|xlsm|xls|docx|doc|pptx|ppt|pdf|png|jpg|jpeg|gif|svg|webp'

const TERMINAL_PATH_SOURCE =
  "file:\\/\\/[^\\s'\"<>|)\\]]+" +
  '|(?<![\\w.])[A-Za-z]:[\\\\/][\\w&\\\\/.-]+(?::\\d+(?::\\d+)?)?' +
  // Home-relative, ahead of the POSIX branch — which matched "~/x" from the
  // slash and opened "/x".
  '|(?<![\\w~])~[\\\\/][\\w&\\\\/.-]+(?::\\d+(?::\\d+)?)?' +
  '|(?<!\\/)\\/[\\w&./-]+(?::\\d+(?::\\d+)?)?' +
  // Relative: any run of ./ and ../ followed by the rest of the path (a lone
  // "./" used to match by itself and split the path in two), or a path with a
  // separator in it.
  '|(?:(?:\\.{1,2}[\\\\/])+[\\w&/\\\\.-]*|[\\w][\\w&/\\\\.-]*[\\\\/][\\w&.-]+)(?::\\d+(?::\\d+)?)?' +
  '|[\\w.-]+\\.(?:' + BARE_FILE_EXTS + ')(?![\\w])(?::\\d+(?::\\d+)?)?'

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
      // "." and "," are path characters, so a path that ends a sentence took
      // the punctuation with it — and "report.xlsx." is not a file.
      const found = match[0].replace(/[.,;:!?]+$/, '')
      if (found) out.push({ index: token.index + match.index, text: found })
    }
  }
  return out
}

// Source/config extensions that open in the code editor. `.md` opens in the
// in-app markdown viewer; everything else — data, documents, PDFs, images,
// html — opens with the OS default program.
const EDITOR_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonc', 'yaml', 'yml', 'toml',
  'css', 'scss', 'less', 'py', 'rs', 'go', 'java', 'kt', 'kts', 'c', 'cc', 'cpp',
  'h', 'hpp', 'cs', 'rb', 'php', 'swift', 'sh', 'bash', 'zsh', 'ps1',
  'env', 'cfg', 'ini', 'conf', 'gradle', 'vue', 'svelte',
])

// "Open with the default program" *runs* these. A path that appeared in
// terminal output is not a request to run something — least of all when a
// program can print a file:// link to it — so they are shown in their folder.
const LAUNCH_EXTS = new Set([
  'exe', 'com', 'scr', 'pif', 'cpl', 'bat', 'cmd', 'msi', 'msp', 'msix', 'appx',
  'lnk', 'url', 'reg', 'vbs', 'vbe', 'jse', 'wsf', 'wsh', 'hta', 'jar',
  'app', 'command', 'dmg', 'pkg', 'appimage', 'desktop', 'deb', 'rpm', 'run',
])

export type TerminalLinkAction = 'markdown' | 'editor' | 'default-app' | 'reveal'

/** What following a link to this file does, by its extension. */
export function terminalLinkAction(path: string): TerminalLinkAction {
  const base = path.split(/[\\/]/).pop() || ''
  const dot = base.lastIndexOf('.')
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
  if (ext === 'md') return 'markdown'
  if (EDITOR_EXTS.has(ext)) return 'editor'
  if (LAUNCH_EXTS.has(ext)) return 'reveal'
  return 'default-app'
}

/**
 * Does this click follow the link?
 *
 * Normally: with the shortcut modifier (Ctrl, or Cmd on a Mac), so a stray
 * click never opens anything — the same gesture as VS Code's terminal.
 *
 * While the program in the terminal tracks the mouse (Claude Code's
 * fullscreen mode, OpenCode, vim) that click goes to the program as well, and
 * Claude Code acts on it itself: answering here too opened every URL twice.
 * So in that state the click must also carry the key that makes xterm keep
 * the click to itself — Shift, or Option on a Mac — which the program never
 * sees. One gesture, one handler.
 *
 * `event: false` is an activation with no mouse event behind it.
 */
export function shouldFollowLink(args: {
  mouseTracking: boolean
  mac: boolean
  event: false | { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }
}): boolean {
  const { mouseTracking, mac, event } = args
  if (!event) return !mouseTracking
  const mod = mac ? event.metaKey : event.ctrlKey
  if (!mod) return false
  if (!mouseTracking) return true
  return mac ? event.altKey : event.shiftKey
}

/** The gesture `shouldFollowLink` accepts, for the hover hint. */
export function linkGestureHint(args: { mouseTracking: boolean; mac: boolean }): string {
  if (args.mac) return args.mouseTracking ? '⌘⌥+click to open' : '⌘+click to open'
  return args.mouseTracking ? 'Ctrl+Shift+click to open' : 'Ctrl+click to open'
}
