import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { probeArtifacts } from '../src/main/autopilot/probe-artifacts'

const TMP = join(__dirname, '.tmp-probe-artifacts')

beforeEach(() => { mkdirSync(TMP, { recursive: true }) })
afterEach(() => { rmSync(TMP, { recursive: true, force: true }) })

describe('probeArtifacts', () => {
  it('returns hasClassic=true when .autopilot/goal.md and milestones/ both exist', () => {
    mkdirSync(join(TMP, '.autopilot', 'milestones'), { recursive: true })
    writeFileSync(join(TMP, '.autopilot', 'goal.md'), '# Goal\n\nx\n')
    const r = probeArtifacts(TMP)
    expect(r.hasClassic).toBe(true)
    expect(r.hasPro).toBe(false)
  })

  it('returns hasPro=true when .autopilot-pro/spec.md exists', () => {
    mkdirSync(join(TMP, '.autopilot-pro'), { recursive: true })
    writeFileSync(join(TMP, '.autopilot-pro', 'spec.md'), '# spec\n')
    const r = probeArtifacts(TMP)
    expect(r.hasClassic).toBe(false)
    expect(r.hasPro).toBe(true)
  })
})
