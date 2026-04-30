import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { discoverValidation } from '../src/main/autopilot/validation'

const TMP = join(__dirname, '.tmp-autopilot-validation')

beforeEach(() => { mkdirSync(TMP, { recursive: true }) })
afterEach(() => { rmSync(TMP, { recursive: true, force: true }) })

describe('discoverValidation', () => {
  it('returns {} for an empty directory', () => {
    expect(discoverValidation(TMP)).toEqual({})
  })

  it('reads scripts from package.json', () => {
    writeFileSync(join(TMP, 'package.json'), JSON.stringify({
      scripts: { test: 'vitest run', build: 'tsc -p .', typecheck: 'tsc --noEmit', lint: 'eslint .' },
    }))
    const v = discoverValidation(TMP)
    expect(v.test).toBe('npm test')
    expect(v.build).toBe('npm run build')
    expect(v.typecheck).toBe('npm run typecheck')
    expect(v.lint).toBe('npm run lint')
  })

  it('prefers test:unit over test when both exist', () => {
    writeFileSync(join(TMP, 'package.json'), JSON.stringify({
      scripts: { test: 'integration', 'test:unit': 'unit' },
    }))
    const v = discoverValidation(TMP)
    expect(v.test).toBe('npm run test:unit')
  })

  it('falls back to "tsc --noEmit" when typecheck script missing but tsconfig.json exists', () => {
    writeFileSync(join(TMP, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }))
    writeFileSync(join(TMP, 'tsconfig.json'), '{}')
    const v = discoverValidation(TMP)
    expect(v.typecheck).toBe('npx tsc --noEmit')
  })

  it('detects Cargo.toml', () => {
    writeFileSync(join(TMP, 'Cargo.toml'), '[package]\nname = "x"\n')
    const v = discoverValidation(TMP)
    expect(v.test).toBe('cargo test')
    expect(v.build).toBe('cargo build')
  })

  it('detects pyproject.toml', () => {
    writeFileSync(join(TMP, 'pyproject.toml'), '[project]\nname = "x"\n')
    const v = discoverValidation(TMP)
    expect(v.test).toBe('pytest')
  })

  it('detects go.mod', () => {
    writeFileSync(join(TMP, 'go.mod'), 'module example.com/x\n')
    const v = discoverValidation(TMP)
    expect(v.test).toBe('go test ./...')
    expect(v.build).toBe('go build ./...')
  })

  it('does not throw when package.json is malformed', () => {
    writeFileSync(join(TMP, 'package.json'), 'not json')
    expect(() => discoverValidation(TMP)).not.toThrow()
    expect(discoverValidation(TMP)).toEqual({})
  })
})
