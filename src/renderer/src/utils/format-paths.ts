/**
 * Format an array of file paths for insertion into a PTY / shell command line.
 * Paths containing whitespace, double-quotes, or shell metacharacters (&|<>)
 * are wrapped in double-quotes with embedded quotes escaped to \".
 */
export function formatPaths(paths: string[]): string {
  const quote = (p: string): string =>
    /[\s"&|<>]/.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p
  return paths.map(quote).join(' ')
}
