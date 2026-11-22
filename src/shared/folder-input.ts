/**
 * A folder path as a person typed or pasted it, for the places that have no
 * native folder picker (the /desktop browser page).
 */

/** Trim, and drop the quotes that come with a copied path: Explorer's "Copy
 *  as path" wraps it in double quotes, a shell drag-and-drop in single ones.
 *  Only a matching pair around the whole thing — a lone quote is part of a
 *  name. */
export function cleanFolderInput(raw: string): string {
  let s = raw.trim()
  while (s.length >= 2) {
    const first = s[0]
    const last = s[s.length - 1]
    if (!((first === '"' && last === '"') || (first === "'" && last === "'"))) break
    s = s.slice(1, -1).trim()
  }
  return s
}

/** Example path in the style of the machine the folder is on — which, on the
 *  browser page, is the host and not the browser's own OS. */
export function folderPathPlaceholder(platform: string): string {
  return platform === 'win32' ? 'C:\\path\\to\\project' : '/path/to/project'
}
