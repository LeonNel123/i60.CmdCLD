// Guards pushes to public remotes: scans content against a pattern file that
// lives OUTSIDE this repo (the pattern list itself enumerates the internal names
// it protects). Configure per machine:
//   git config leakcheck.patternsfile <absolute path to private pattern file>
// Missing config or file = warn and pass, so clones without the private file
// are not blocked.
//
// Modes:
//   node scripts/check-leaks.mjs                 scan all tracked files
//   node scripts/check-leaks.mjs --staged        scan staged changes
//   node scripts/check-leaks.mjs --push L R      scan commits R..L (pre-push hook)
//
// docs/integration/ is exempt until the exchange-hub migration retires it.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const EXEMPT = [/^docs\/integration\//]
const ZEROS = /^0+$/
const NUL = String.fromCharCode(0)

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
}

function loadPatterns() {
  let file
  try { file = git('config', 'leakcheck.patternsfile').trim() } catch { /* unset */ }
  if (!file || !existsSync(file)) {
    console.warn(`check-leaks: no pattern file (${file || 'leakcheck.patternsfile unset'}) — skipping scan`)
    process.exit(0)
  }
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => new RegExp(l, 'i'))
}

function isExempt(path) {
  return EXEMPT.some((re) => re.test(path))
}

// Scan unified-diff text (git diff / git log -p). Commit-message lines are
// scanned too; hunks belonging to exempt files are skipped.
function scanDiff(text, patterns, label) {
  const hits = []
  let file = null
  let exempt = false
  for (const line of text.split('\n')) {
    // --- a/<path> sets the file too: deleted files have "+++ /dev/null", and
    // without this their hunks would be mistaken for commit-message text.
    const fileStart = line.match(/^(?:\+\+\+ b|--- a)\/(.*)$/)
    if (fileStart) { file = fileStart[1]; exempt = isExempt(file); continue }
    if (line.startsWith('diff --git')) { file = null; exempt = false; continue }
    if (exempt) continue
    const isAddedLine = file && line.startsWith('+')
    const isMessageLine = !file
    if (!isAddedLine && !isMessageLine) continue
    for (const re of patterns) {
      if (re.test(line)) hits.push(`${label}${file ? ` ${file}` : ''}: ${line.trim().slice(0, 120)}  [${re.source}]`)
    }
  }
  return hits
}

function scanTrackedFiles(patterns) {
  const hits = []
  const files = git('ls-files').split('\n').filter((f) => f && !isExempt(f))
  for (const f of files) {
    let content
    try { content = readFileSync(f, 'utf8') } catch { continue }
    if (content.includes(NUL)) continue // binary
    content.split('\n').forEach((line, i) => {
      for (const re of patterns) {
        if (re.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}  [${re.source}]`)
      }
    })
  }
  return hits
}

const patterns = loadPatterns()
const [mode, a, b] = process.argv.slice(2)
let hits
if (mode === '--staged') {
  hits = scanDiff(git('diff', '--cached', '-U0'), patterns, 'staged')
} else if (mode === '--push') {
  const range = ZEROS.test(b) ? [a, '-n', '100'] : [`${b}..${a}`]
  hits = scanDiff(git('log', '-p', '-U0', '--format=%h %s%n%b', ...range), patterns, 'push')
} else {
  hits = scanTrackedFiles(patterns)
}

if (hits.length) {
  console.error(`check-leaks: ${hits.length} match(es) against the private pattern list:\n`)
  for (const h of hits) console.error('  ' + h)
  console.error('\nRemove the flagged content (or move it to the private hub) before pushing.')
  process.exit(1)
}
console.log('check-leaks: clean')
