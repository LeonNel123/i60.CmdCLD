/** Turn dropped File objects into absolute paths.
 *
 *  A File exposes no usable path: Electron removed the non-standard
 *  `File.path` in v32, so reading it yields undefined and every drop
 *  silently forwards nothing. The path must come from
 *  `webUtils.getPathForFile`, passed in as `resolve` (bridged through the
 *  preload). Files the resolver can't handle — a synthetic drop, a file
 *  outside the sandbox — are skipped rather than failing the whole drop.
 */
export function extractDroppedPaths(
  files: File[],
  resolve: (file: File) => string | undefined,
): string[] {
  const paths: string[] = []
  for (const file of files) {
    let resolved: string | undefined
    try {
      resolved = resolve(file)
    } catch {
      continue
    }
    if (resolved) paths.push(resolved)
  }
  return paths
}
