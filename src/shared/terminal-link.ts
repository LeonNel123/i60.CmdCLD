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
