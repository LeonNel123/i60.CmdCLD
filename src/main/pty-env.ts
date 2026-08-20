/**
 * Environment handed to every PTY.
 *
 * Passing `process.env` straight through has two consequences that show up as odd CLI
 * behaviour rather than as errors:
 *
 * 1. COLORTERM is usually absent, because most launchers do not set it. Agent CLIs read
 *    it to decide whether they may emit 24-bit colour, so without it they downgrade to a
 *    reduced palette — the same session renders with less styling in CmdCLD than in a
 *    terminal that advertises truecolor, while basic colours still work.
 *
 * 2. Terminal identity from whatever launched the app leaks in. Start CmdCLD from a VS
 *    Code terminal and every session inherits TERM_PROGRAM=vscode plus the VSCODE_*
 *    hooks, so a CLI believes it is running inside VS Code — affecting IDE auto-connect,
 *    shell integration and git askpass, none of which point anywhere useful here.
 */

/** Host-specific variables that must not describe CmdCLD's sessions. */
const STRIPPED_PREFIXES = ['VSCODE_']
const STRIPPED_EXACT = ['TERM_PROGRAM', 'TERM_PROGRAM_VERSION']

export interface PtyEnvOptions {
  /** Reported as TERM_PROGRAM_VERSION so a CLI can identify the host precisely. */
  appVersion?: string
}

export function buildPtyEnv(
  base: NodeJS.ProcessEnv | Record<string, string | undefined>,
  opts: PtyEnvOptions = {},
): Record<string, string> {
  const out: Record<string, string> = {}

  for (const [key, value] of Object.entries(base)) {
    if (value == null) continue
    if (STRIPPED_EXACT.includes(key)) continue
    if (STRIPPED_PREFIXES.some((p) => key.startsWith(p))) continue
    out[key] = value
  }

  // xterm.js renders 24-bit colour, so say so. Without this a CLI assumes 256 at best.
  out.COLORTERM = 'truecolor'
  out.TERM_PROGRAM = 'CmdCLD'
  if (opts.appVersion) out.TERM_PROGRAM_VERSION = opts.appVersion

  return out
}
