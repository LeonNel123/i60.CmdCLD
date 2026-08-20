#!/usr/bin/env node
// Full production cycle: verify -> release -> update this machine's installed app.
//
// Cross-platform (Windows and macOS) and idempotent: every stage decides for itself
// whether there is anything to do, so re-running after a partial failure resumes rather
// than repeating work. Safe to run on both machines against the same commit — the second
// one finds the release already built and only refreshes its local install.
//
//   node scripts/release-cycle.mjs               full cycle
//   node scripts/release-cycle.mjs --dry-run     report what each stage would do
//   node scripts/release-cycle.mjs --skip-release  refresh the local install only
//   node scripts/release-cycle.mjs --no-wait     tag and push without waiting for CI
//
// It never touches userData. Databases, settings and prompt history live there, and the
// install directory holds only the app bundle — see assertNotUserData().

import { execFileSync, execSync } from 'node:child_process'
import { existsSync, readFileSync, mkdirSync, cpSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
const args = new Set(process.argv.slice(2))
const DRY = args.has('--dry-run')
const SKIP_VERIFY = args.has('--skip-verify')
const SKIP_RELEASE = args.has('--skip-release')
const SKIP_INSTALL = args.has('--skip-install')
const NO_WAIT = args.has('--no-wait')

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
}
const step = (s) => console.log(`\n${c.bold('▸ ' + s)}`)
const ok = (s) => console.log(`  ${c.green('✓')} ${s}`)
const skip = (s) => console.log(`  ${c.yellow('•')} ${c.dim(s)}`)
const info = (s) => console.log(`  ${c.dim(s)}`)
const die = (s) => { console.error(`  ${c.red('✗')} ${s}`); process.exit(1) }

function sh(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim()
}
function shLoud(cmd) {
  if (DRY) { info(`would run: ${cmd}`); return }
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' })
}
function tryShell(cmd) {
  try { return sh(cmd) } catch { return null }
}

const pkg = () => JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

// ---------------------------------------------------------------- preflight

/**
 * Returns true when work arrived from origin, which forces the verify stage to run even
 * if it was skipped: whatever came in has never been checked together with local work.
 */
function preflight() {
  step('Preflight')

  if (sh('git status --porcelain')) {
    die('Working tree is dirty. Commit or stash first — a release must be reproducible from the tag.')
  }
  ok('working tree clean')

  const branch = sh('git rev-parse --abbrev-ref HEAD')
  if (branch !== 'master') {
    die(`On branch "${branch}". Releases are cut from master.`)
  }
  ok('on master')

  sh('git fetch --quiet origin')
  const counts = sh('git rev-list --left-right --count master...origin/master').split(/\s+/)
  const ahead = Number(counts[0])
  const behind = Number(counts[1])
  let pulled = false

  if (behind > 0) {
    // The other machine has pushed since this one last looked. Integrate before
    // releasing, so the tag covers everything rather than silently omitting it.
    info(`${behind} commit(s) on origin not here yet — integrating before release`)
    if (DRY) {
      info('would run: git pull --ff-only origin master (falling back to merge)')
    } else if (ahead === 0) {
      try {
        shLoud('git pull --ff-only origin master')
      } catch {
        die('Fast-forward pull failed unexpectedly. Resolve by hand and re-run.')
      }
    } else {
      // Both sides moved. A merge is the honest resolution; conflicts stop the cycle
      // rather than being guessed at.
      info(`local also has ${ahead} unpushed commit(s) — merging`)
      try {
        shLoud('git merge --no-edit origin/master')
      } catch {
        die('Merge hit conflicts. Resolve them, commit, then re-run this script.')
      }
      if (sh('git status --porcelain')) {
        die('Merge left the tree dirty (conflicts). Resolve, commit, then re-run.')
      }
    }
    pulled = true
    ok(`integrated origin/master — now at ${sh('git rev-parse --short HEAD')}`)
  }

  const aheadNow = Number(sh('git rev-list --count origin/master..master'))
  if (aheadNow > 0) {
    info(`${aheadNow} commit(s) not yet pushed — they will go out with the release`)
    shLoud('git push origin master')
    ok('pushed')
  } else if (!pulled) {
    ok('in sync with origin')
  }

  if (!tryShell('gh --version')) die('GitHub CLI (gh) not found — needed to watch and verify the release.')
  if (!tryShell('gh auth status')) die('GitHub CLI is not authenticated. Run: gh auth login')
  ok('gh authenticated')

  return pulled
}

// ---------------------------------------------------------------- verify

function verify({ forced = false } = {}) {
  step('Verify')
  if (SKIP_VERIFY && forced) {
    info('--skip-verify overridden: code arrived from origin and has not been checked with local work')
  } else if (SKIP_VERIFY) {
    skip('skipped (--skip-verify)')
    return
  }
  shLoud('npm test')
  ok('tests pass')
  shLoud('npx tsc --noEmit -p tsconfig.node.json')
  shLoud('npx tsc --noEmit -p tsconfig.web.json')
  ok('typecheck clean (both projects)')
  shLoud('npm run build')
  ok('build succeeds')
}

// ---------------------------------------------------------------- release

/**
 * Is HEAD already released?
 *
 * Version strings are not enough. package.json can read 1.6.27 while HEAD sits several
 * commits past the v1.6.27 tag, so the only honest test is whether some release tag
 * points at this exact commit and its GitHub release actually carries installers.
 */
function releasedAtHead() {
  const head = sh('git rev-parse HEAD')
  const tags = tryShell(`git tag --points-at ${head}`)
  for (const tag of (tags || '').split('\n').map((t) => t.trim()).filter(Boolean)) {
    const assets = tryShell(`gh release view ${tag} --json assets --jq "[.assets[].name] | join(\\",\\")"`)
    if (assets && /\.(exe|dmg|AppImage)/.test(assets)) return { tag, assets: assets.split(',') }
  }
  return null
}

function release() {
  step('Release')
  if (SKIP_RELEASE) { skip('skipped (--skip-release)'); return releasedAtHead() }

  const already = releasedAtHead()
  if (already) {
    // This is the second machine, or a re-run. Nothing to build.
    skip(`${already.tag} already published for this commit — nothing to build`)
    info(`assets: ${already.assets.filter((a) => !a.endsWith('.blockmap')).join(', ')}`)
    return already
  }

  const before = pkg().version
  info(`bumping from ${before} and pushing the tag`)
  if (DRY) { info('would run: npm run release:tag'); return null }
  shLoud('npm run release:tag')
  const tag = `v${pkg().version}`
  ok(`tagged ${tag}`)

  if (NO_WAIT) { skip('not waiting for CI (--no-wait)'); return { tag, assets: [] } }

  info('waiting for the release workflow (Windows, macOS, Linux) …')
  // The run takes a moment to appear after the push.
  execSync('node -e "setTimeout(()=>{},12000)"', { stdio: 'ignore' })
  const runId = tryShell('gh run list --workflow=release.yml --limit 1 --json databaseId --jq ".[0].databaseId"')
  if (!runId) die('Could not find the release workflow run. Check the Actions tab.')
  try {
    execSync(`gh run watch ${runId} --exit-status --interval 25`, { cwd: ROOT, stdio: 'inherit' })
  } catch {
    die(`Release workflow failed. Inspect it with: gh run view ${runId} --log-failed`)
  }

  const published = tryShell(`gh release view ${tag} --json assets,isDraft --jq "{draft:.isDraft, n:([.assets[].name]|length)}"`)
  ok(`published ${tag} ${c.dim(published || '')}`)
  return { tag, assets: [] }
}

// ---------------------------------------------------------------- local install

/**
 * Where this platform keeps the installed app's bundle, and where the freshly built
 * bundle lands. Only the bundle is replaced — see assertNotUserData.
 */
function installPaths() {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    // electron-builder's NSIS target installs per-user under Programs/<name>.
    const candidates = [join(base, 'Programs', 'cmdcld'), join(base, 'Programs', 'CmdCLD')]
    const installed = candidates.find((p) => existsSync(join(p, 'resources', 'app.asar')))
    return {
      label: 'Windows',
      installedResources: installed ? join(installed, 'resources') : null,
      builtResources: join(ROOT, 'dist', 'win-unpacked', 'resources'),
      userData: join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'CmdCLD'),
      buildCmd: 'npx electron-builder --win --dir',
      appRoot: installed,
    }
  }
  if (process.platform === 'darwin') {
    const app = ['/Applications/CmdCLD.app', join(homedir(), 'Applications', 'CmdCLD.app')]
      .find((p) => existsSync(join(p, 'Contents', 'Resources', 'app.asar')))
    // electron-builder writes dist/mac-arm64 on Apple Silicon, dist/mac on Intel.
    const built = ['mac-arm64', 'mac', 'mac-universal']
      .map((d) => join(ROOT, 'dist', d, 'CmdCLD.app', 'Contents', 'Resources'))
      .find((p) => existsSync(p))
    return {
      label: 'macOS',
      installedResources: app ? join(app, 'Contents', 'Resources') : null,
      builtResources: built || join(ROOT, 'dist', 'mac-arm64', 'CmdCLD.app', 'Contents', 'Resources'),
      userData: join(homedir(), 'Library', 'Application Support', 'CmdCLD'),
      buildCmd: 'npx electron-builder --mac --dir',
      appRoot: app,
    }
  }
  return { label: process.platform, installedResources: null, unsupported: true }
}

/**
 * Refuse to write anywhere near userData.
 *
 * The databases (recent.db, prompts.db), settings.json and session state all live in
 * userData, and the whole point of patching the install in place is that they survive
 * untouched. This is the guard that keeps a future edit from pointing the copy at them.
 */
function assertNotUserData(target, userData) {
  const t = resolve(target).toLowerCase()
  const u = resolve(userData).toLowerCase()
  if (t === u || t.startsWith(u + (process.platform === 'win32' ? '\\' : '/'))) {
    die(`Refusing to write into userData (${userData}). Databases and settings live there.`)
  }
}

function appRunning() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq CmdCLD.exe'], { encoding: 'utf8' })
      return /CmdCLD\.exe/i.test(out)
    }
    const out = execFileSync('pgrep', ['-x', 'CmdCLD'], { encoding: 'utf8' })
    return out.trim().length > 0
  } catch {
    return false
  }
}

function updateLocalInstall() {
  step('Update this machine')
  if (SKIP_INSTALL) { skip('skipped (--skip-install)'); return }

  const p = installPaths()
  if (p.unsupported) {
    skip(`${p.label}: in-place update is not supported (AppImage is a single file) — download from the release instead`)
    return
  }
  if (!p.installedResources) {
    skip(`no installed CmdCLD found on this ${p.label} machine — install from the release first`)
    return
  }
  info(`${p.label}: ${p.appRoot}`)
  info(`userData left alone: ${p.userData}`)

  if (appRunning()) {
    die('CmdCLD is running. Close it first — its files are locked while it runs.')
  }
  ok('app is not running')

  // The Electron runtime only changes when the electron dependency does; the app code
  // lives entirely in resources/. Copying just that is seconds instead of ~200 MB.
  if (DRY) { info(`would run: ${p.buildCmd}`); info(`would copy ${p.builtResources} -> ${p.installedResources}`); return }
  shLoud(p.buildCmd)
  if (!existsSync(join(p.builtResources, 'app.asar'))) {
    die(`Build produced no app.asar at ${p.builtResources}`)
  }

  assertNotUserData(p.installedResources, p.userData)
  mkdirSync(p.installedResources, { recursive: true })
  // force+recursive, and NOT a mirror: extra files already in the target (an uninstaller,
  // a previous backup) are left in place rather than deleted.
  cpSync(p.builtResources, p.installedResources, { recursive: true, force: true })

  const size = (statSync(join(p.installedResources, 'app.asar')).size / 1048576).toFixed(1)
  ok(`installed app refreshed (app.asar ${size} MB) — databases and settings untouched`)
}

// ---------------------------------------------------------------- main

console.log(c.bold(`\nCmdCLD release cycle  ${c.dim(`(${process.platform}, v${pkg().version})`)}`))
if (DRY) console.log(c.yellow('  dry run — nothing will be changed'))

const pulledFromOrigin = preflight()
verify({ forced: pulledFromOrigin })
release()
updateLocalInstall()

console.log(`\n${c.green('Done.')} ${c.dim('Releases: https://github.com/LeonNel123/i60.CmdCLD/releases/latest')}\n`)
