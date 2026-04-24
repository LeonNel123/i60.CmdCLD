import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'

const exec = promisify(execFile)

// Timeouts keep the UI responsive if the daemon is wedged.
const CLI_TIMEOUT_MS = 5000

// The Mac App Store build of Tailscale does not install a `tailscale` symlink
// on PATH — the CLI lives inside the app bundle. Probe known locations so the
// app works whether the user installed via brew, the standalone pkg, or the
// App Store.
const MACOS_FALLBACK_PATHS = [
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/usr/local/bin/tailscale',
  '/opt/homebrew/bin/tailscale',
]

let cachedCliPath: string | null = null

function resolveCliPath(): string {
  if (cachedCliPath) return cachedCliPath
  if (process.platform === 'darwin') {
    for (const p of MACOS_FALLBACK_PATHS) {
      if (existsSync(p)) {
        cachedCliPath = p
        return p
      }
    }
  }
  // Default — let execFile resolve via PATH (and ENOENT if missing).
  cachedCliPath = 'tailscale'
  return cachedCliPath
}

export interface TailscaleStatus {
  installed: boolean
  loggedIn: boolean
  online: boolean
  httpsEnabled: boolean
  httpsHost: string | null // e.g. "my-pc.tailnet-xyz.ts.net"
  error: string | null
}

async function runTailscale(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return exec(resolveCliPath(), args, { timeout: CLI_TIMEOUT_MS })
}

// `tailscale status --json` gives us everything we need:
//   - Self.DNSName → the magicDNS host (requires HTTPS to be enabled to work)
//   - Self.Online → whether the tailnet sees us
//   - BackendState === "Running" → daemon is happy
//   - CurrentTailnet.MagicDNSSuffix → presence implies MagicDNS is on
export async function getStatus(): Promise<TailscaleStatus> {
  const status: TailscaleStatus = {
    installed: false,
    loggedIn: false,
    online: false,
    httpsEnabled: false,
    httpsHost: null,
    error: null,
  }

  try {
    const { stdout } = await runTailscale(['status', '--json'])
    status.installed = true
    const parsed = JSON.parse(stdout) as {
      BackendState?: string
      Self?: { DNSName?: string; Online?: boolean }
      CurrentTailnet?: { MagicDNSSuffix?: string } | null
      CertDomains?: string[] | null
    }

    if (parsed.BackendState === 'NeedsLogin') {
      status.error = 'Tailscale is installed but you are not signed in (tailscale up).'
      return status
    }
    if (parsed.BackendState !== 'Running') {
      status.error = `Tailscale backend state: ${parsed.BackendState || 'unknown'}`
      return status
    }

    status.loggedIn = true
    status.online = !!parsed.Self?.Online

    const dns = (parsed.Self?.DNSName || '').replace(/\.$/, '')
    status.httpsHost = dns || null

    // CertDomains is populated only when HTTPS is enabled in the admin panel.
    // Fall back to checking that DNSName has a MagicDNS suffix as a weaker signal.
    const certDomains = parsed.CertDomains || []
    if (certDomains.length > 0) {
      status.httpsEnabled = true
    } else if (parsed.CurrentTailnet?.MagicDNSSuffix && dns.endsWith('.ts.net')) {
      // Best-effort guess — the actual `serve` call will surface the truth.
      status.httpsEnabled = true
    }

    return status
  } catch (e: unknown) {
    const err = e as { code?: string; stderr?: string; message?: string }
    if (err.code === 'ENOENT') {
      status.error = 'Tailscale CLI not found. Install Tailscale.app or `brew install tailscale`.'
    } else if (err.stderr) {
      status.error = String(err.stderr).trim()
    } else {
      status.error = err.message || 'Unknown tailscale error'
    }
    return status
  }
}

// `tailscale serve status --json` returns what, if anything, is currently
// mapped. Empty/absent means nothing served.
export async function getServeStatus(): Promise<{ active: boolean; url: string | null; raw?: unknown }> {
  try {
    const { stdout } = await runTailscale(['serve', 'status', '--json'])
    if (!stdout.trim()) return { active: false, url: null }
    const parsed = JSON.parse(stdout) as {
      Web?: Record<string, { Handlers?: Record<string, unknown> }>
    }
    const web = parsed.Web || {}
    const keys = Object.keys(web)
    if (keys.length === 0) return { active: false, url: null, raw: parsed }
    // Keys look like "my-pc.tailnet.ts.net:443" — synthesise a URL from the first one.
    const first = keys[0]
    const host = first.split(':')[0]
    return { active: true, url: `https://${host}`, raw: parsed }
  } catch {
    return { active: false, url: null }
  }
}

// Start serving. `tailscale serve` returns immediately in --bg mode.
export async function startServe(port: number): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    await runTailscale(['serve', '--bg', '--https=443', `http://localhost:${port}`])
    const serveStatus = await getServeStatus()
    if (serveStatus.url) return { ok: true, url: serveStatus.url }
    // Fallback: derive from `tailscale status` hostname
    const s = await getStatus()
    if (s.httpsHost) return { ok: true, url: `https://${s.httpsHost}` }
    return { ok: true }
  } catch (e: unknown) {
    const err = e as { code?: string; stderr?: string; message?: string }
    let msg = err.stderr?.trim() || err.message || 'Failed to start tailscale serve'
    if (err.code === 'ENOENT') msg = 'Tailscale CLI not found. Install Tailscale.app or `brew install tailscale`.'
    return { ok: false, error: msg }
  }
}

// Stop serving. Note: `tailscale serve reset` clears ALL serve config for the
// machine, not just ours. We document this in the UI.
export async function stopServe(): Promise<{ ok: boolean; error?: string }> {
  try {
    await runTailscale(['serve', 'reset'])
    return { ok: true }
  } catch (e: unknown) {
    const err = e as { code?: string; stderr?: string; message?: string }
    return { ok: false, error: err.stderr?.trim() || err.message || 'Failed to reset tailscale serve' }
  }
}
