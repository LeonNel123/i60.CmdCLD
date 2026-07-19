// Resolution of file paths clicked in a terminal. A path printed by a CLI is
// frequently relative to the terminal's working directory ("docs/NOTES.md",
// "src/main.ts:12:5"); anything not absolute must be joined onto the
// terminal's folder before the main process can read or open it — the main
// process resolves paths against the app's cwd, not the terminal's.

// Absolute forms: "C:\x" / "C:/x" (drive), "\\server\share" (UNC), and a
// leading slash or backslash (POSIX absolute / Windows drive-relative —
// either way, never something to join onto the project folder).
const ABSOLUTE_RE = /^([a-zA-Z]:[\\/]|[\\/])/

/** Strip a trailing :line[:col] suffix and make the path absolute by joining
 *  relative paths onto the terminal's folder. */
export function resolveTerminalPath(raw: string, folderPath: string, platform: string): string {
  const filePart = raw.replace(/:\d+(:\d+)?$/, '')
  if (ABSOLUTE_RE.test(filePart)) return filePart
  const sep = platform === 'win32' ? '\\' : '/'
  return folderPath + sep + filePart
}

// Detection of clickable path-shaped runs in a line of terminal output.
// Branches, in order: file:// URLs; Windows drive paths in either slash style
// (the lookbehind stops the "s://" tail of an http URL matching as a drive);
// POSIX absolute paths not inside a URL; relative paths containing a
// separator; and bare filenames with a known extension. Each accepts an
// optional trailing :line[:col].
const TERMINAL_PATH_SOURCE =
  "file:\\/\\/[^\\s'\"<>|)\\]]+" +
  '|(?<![\\w.])[A-Za-z]:[\\\\/][\\w\\\\/.-]+(?::\\d+(?::\\d+)?)?' +
  '|(?<!\\/)\\/[\\w./-]+(?::\\d+(?::\\d+)?)?' +
  '|(?:\\.[\\\\/]|\\.\\.[\\\\/]|[\\w][\\w/\\\\.-]*[\\\\/][\\w.-]+)(?::\\d+(?::\\d+)?)?' +
  '|[\\w.-]+\\.(?:md|ts|tsx|js|jsx|json|yaml|yml|toml|css|html|py|rs|go|java|sh|sql|xml|csv|txt|log|env|cfg|ini|conf)(?::\\d+(?::\\d+)?)?'

/** Find path-shaped runs in a line of terminal output. Returns each match with
 *  its start index so callers can map back to buffer coordinates. A fresh
 *  regex per call keeps the /g lastIndex from leaking between lines. */
export function findTerminalPaths(text: string): Array<{ index: number; text: string }> {
  const re = new RegExp(`(?:${TERMINAL_PATH_SOURCE})`, 'gi')
  const out: Array<{ index: number; text: string }> = []
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) out.push({ index: match.index, text: match[0] })
  return out
}
