import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

export type ThresholdCallback = (percent: 50 | 80 | 100) => void

interface PersistedShape {
  totalUsd: number
  capUsd: number
  thresholdsHit: number[]
}

export class CostTracker {
  totalUsd = 0
  capUsd: number
  private thresholdsHit = new Set<number>()
  private controlDir: string
  private cb?: ThresholdCallback

  /**
   * @param controlDir the orchestrator's own state directory — `.autopilot`,
   *   `.autopilot-pro` or `.autopilot-council`, not the project root.
   *
   * It used to take the project path and append '.autopilot' itself, which was right for
   * exactly one caller. PRO passed its own control dir, as every other PRO write does, and
   * the hidden segment turned that into `.autopilot-pro/.autopilot/cost.json` — a
   * classic-named directory nested inside PRO's, and not the path the doer contract tells
   * the doer to leave uncommitted. Taking the directory outright removes the trap.
   */
  constructor(controlDir: string, capUsd: number, cb?: ThresholdCallback) {
    this.controlDir = controlDir
    this.capUsd = capUsd
    this.cb = cb
    this.load()
  }

  private file(): string {
    return join(this.controlDir, 'cost.json')
  }

  private load(): void {
    try {
      if (!existsSync(this.file())) return
      const data = JSON.parse(readFileSync(this.file(), 'utf-8')) as PersistedShape
      if (typeof data.totalUsd === 'number') this.totalUsd = data.totalUsd
      // NOTE: the persisted capUsd is deliberately NOT restored. The cap is a
      // live setting owned by the kickoff form; restoring it stopped a run that
      // paused at its cap from being restarted with a raised one. The persisted
      // thresholdsHit is likewise ignored — it was crossed against the old cap,
      // so it is re-derived from the live one instead.
      this.markCrossedThresholdsSilently()
    } catch {
      // ignore corrupt; start clean
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.file()), { recursive: true })
      const data: PersistedShape = {
        totalUsd: this.totalUsd,
        capUsd: this.capUsd,
        thresholdsHit: [...this.thresholdsHit],
      }
      writeFileSync(this.file(), JSON.stringify(data, null, 2))
    } catch {
      // best-effort
    }
  }

  add(usd: number): void {
    if (!Number.isFinite(usd) || usd <= 0) return
    this.totalUsd += usd
    this.checkThresholds()
    this.persist()
  }

  private checkThresholds(): void {
    const pct = this.percent()
    for (const t of [50, 80, 100] as const) {
      if (pct >= t && !this.thresholdsHit.has(t)) {
        this.thresholdsHit.add(t)
        this.cb?.(t)
      }
    }
  }

  percent(): number {
    if (this.capUsd <= 0) return 0
    return (this.totalUsd / this.capUsd) * 100
  }

  isOverCap(): boolean {
    return this.totalUsd >= this.capUsd
  }

  extendCap(newCapUsd: number): void {
    this.capUsd = newCapUsd
    this.markCrossedThresholdsSilently()
    this.persist()
  }

  /** Reset thresholdsHit to exactly those already crossed at the current cap,
   *  without firing callbacks. Used on load and whenever the cap moves. */
  private markCrossedThresholdsSilently(): void {
    this.thresholdsHit.clear()
    const pct = this.percent()
    for (const t of [50, 80, 100] as const) {
      if (pct >= t) this.thresholdsHit.add(t)
    }
  }
}
