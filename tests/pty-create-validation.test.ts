import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { validatePtyCreate } from '../src/main/pty-create-validation'

const TMP = join(__dirname, '.tmp-pty-create-validation')

beforeEach(() => { mkdirSync(TMP, { recursive: true }) })
afterEach(() => { rmSync(TMP, { recursive: true, force: true }) })

describe('validatePtyCreate', () => {
  it('accepts a real directory with a free id and an owning window', () => {
    expect(validatePtyCreate({ id: 't1', cwd: TMP, hasWindow: true, idInUse: false })).toBeNull()
  })

  it('rejects a folder that does not exist, naming it', () => {
    const missing = join(TMP, 'nope')
    const err = validatePtyCreate({ id: 't1', cwd: missing, hasWindow: true, idInUse: false })
    expect(err).toBeTruthy()
    expect(err).toContain(missing)
  })

  it('rejects a path that is a file rather than a folder', () => {
    const file = join(TMP, 'a.txt')
    writeFileSync(file, 'x')
    const err = validatePtyCreate({ id: 't1', cwd: file, hasWindow: true, idInUse: false })
    expect(err).toBeTruthy()
    expect(err).toContain(file)
  })

  it('rejects an id that already has a terminal', () => {
    const err = validatePtyCreate({ id: 't1', cwd: TMP, hasWindow: true, idInUse: true })
    expect(err).toBeTruthy()
    expect(err).toContain('t1')
  })

  it('rejects a request with no owning window', () => {
    expect(validatePtyCreate({ id: 't1', cwd: TMP, hasWindow: false, idInUse: false })).toBeTruthy()
  })

  it('rejects a blank cwd', () => {
    expect(validatePtyCreate({ id: 't1', cwd: '', hasWindow: true, idInUse: false })).toBeTruthy()
  })

  // This refusal is load-bearing beyond its error message. TerminalPanel chains the
  // agent launch write to a *successful* create, so 'already exists' is what stops the
  // launch command being typed into a session that is already running — the injection
  // bug where 'claude --dangerously-skip-permissions --continue' arrived as a chat
  // message in a live Claude tile.
  it('refuses an id already in use, whatever else is valid', () => {
    const err = validatePtyCreate({ id: 't1', cwd: TMP, hasWindow: true, idInUse: true })
    expect(err).toBeTruthy()
    expect(err).toContain('already exists')
    expect(err).toContain('t1')
  })
})
