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
  private projectPath: string
  private cb?: ThresholdCallback

  constructor(projectPath: string, capUsd: number, cb?: ThresholdCallback) {
    this.projectPath = projectPath
    this.capUsd = capUsd
    this.cb = cb
    this.load()
  }

  private file(): string {
    return join(this.projectPath, '.autopilot', 'cost.json')
  }

  private load(): void {
    try {
      if (!existsSync(this.file())) return
      const data = JSON.parse(readFileSync(this.file(), 'utf-8')) as PersistedShape
      if (typeof data.totalUsd === 'number') this.totalUsd = data.totalUsd
      if (typeof data.capUsd === 'number') this.capUsd = data.capUsd
      if (Array.isArray(data.thresholdsHit)) this.thresholdsHit = new Set(data.thresholdsHit)
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
    this.thresholdsHit.clear()
    // Pre-mark already-crossed thresholds silently (no callbacks)
    const pct = this.percent()
    for (const t of [50, 80, 100] as const) {
      if (pct >= t) this.thresholdsHit.add(t)
    }
    this.persist()
  }
}
