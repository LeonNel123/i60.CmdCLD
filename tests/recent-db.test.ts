import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { RecentDB, getEffectiveRoot, checkPathStatus } from '../src/main/recent-db'
import { mkdirSync, rmSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const TEST_DIR = join(__dirname, '.tmp-recent-test')
const DB_PATH = join(TEST_DIR, 'recent.db')

let db: RecentDB

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true })
  db = new RecentDB(DB_PATH)
})

afterEach(() => {
  db.close()
  rmSync(TEST_DIR, { recursive: true, force: true })
})

describe('RecentDB', () => {
  it('starts with empty list', async () => {
    expect(await db.list()).toEqual([])
  })

  it('adds and retrieves a folder', async () => {
    await db.add('C:\\projects\\my-app')
    const list = await db.list()
    expect(list).toHaveLength(1)
    expect(list[0].path).toBe('C:\\projects\\my-app')
    expect(list[0].name).toBe('my-app')
    expect(list[0].lastOpened).toBeGreaterThan(0)
  })

  it('no duplicates — upserts on same path', async () => {
    await db.add('C:\\projects\\my-app')
    await db.add('C:\\projects\\my-app')
    expect(await db.list()).toHaveLength(1)
  })

  it('most recently added appears first', async () => {
    await db.add('C:\\older')
    await db.add('C:\\newer')
    const list = await db.list()
    expect(list[0].path).toBe('C:\\newer')
    expect(list[1].path).toBe('C:\\older')
  })

  it('prunes to 20 entries', async () => {
    for (let i = 0; i < 25; i++) {
      await db.add(`C:\\folder-${i}`)
    }
    expect(await db.list()).toHaveLength(20)
  })

  it('prune keeps most recent, drops oldest', async () => {
    for (let i = 0; i < 25; i++) {
      await db.add(`C:\\folder-${String(i).padStart(2, '0')}`)
    }
    const list = await db.list()
    const paths = list.map((f) => f.path)
    expect(paths).not.toContain('C:\\folder-00')
    expect(paths).toContain('C:\\folder-24')
  })

  it('removes a folder by path', async () => {
    await db.add('C:\\projects\\keep-me')
    await db.add('C:\\projects\\delete-me')
    await db.remove('C:\\projects\\delete-me')
    const list = await db.list()
    expect(list).toHaveLength(1)
    expect(list[0].path).toBe('C:\\projects\\keep-me')
  })

  it('remove on non-existent path is a no-op', async () => {
    await db.add('C:\\projects\\a')
    await db.remove('C:\\projects\\does-not-exist')
    expect(await db.list()).toHaveLength(1)
  })
})

// ---------- getEffectiveRoot ----------

describe('getEffectiveRoot', () => {
  let originalPlatform: PropertyDescriptor | undefined

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  })

  function setPlatform(p: string) {
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: p, configurable: true })
  }

  it('Windows local: D:\\foo → D:\\', () => {
    setPlatform('win32')
    expect(getEffectiveRoot('D:\\foo')).toBe('D:\\')
  })

  it('Windows UNC: \\\\srv\\share\\foo → \\\\srv\\share\\', () => {
    setPlatform('win32')
    expect(getEffectiveRoot('\\\\srv\\share\\foo')).toBe('\\\\srv\\share\\')
  })

  it('Unix root: /home/x → /', () => {
    setPlatform('linux')
    expect(getEffectiveRoot('/home/x')).toBe('/')
  })

  it('darwin volumes: /Volumes/USB/x → /Volumes/USB', () => {
    setPlatform('darwin')
    expect(getEffectiveRoot('/Volumes/USB/x')).toBe('/Volumes/USB')
  })

  it('Linux media: /media/x/y → /media/x', () => {
    setPlatform('linux')
    expect(getEffectiveRoot('/media/x/y')).toBe('/media/x')
  })

  it('Linux mnt: /mnt/x/y → /mnt/x', () => {
    setPlatform('linux')
    expect(getEffectiveRoot('/mnt/x/y')).toBe('/mnt/x')
  })
})

// ---------- checkPathStatus ----------

describe('checkPathStatus', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cmdcld-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('existing dir → ok', () => {
    expect(checkPathStatus(tmpDir)).toBe('ok')
  })

  it('missing path on existing drive → missing', () => {
    const missingPath = join(tmpDir, 'this-does-not-exist-xyz')
    expect(checkPathStatus(missingPath)).toBe('missing')
  })

  it('missing path on missing drive → unmounted (Windows only)', () => {
    if (process.platform !== 'win32') return
    // Z: is almost certainly not mounted on a standard dev machine
    expect(checkPathStatus('Z:\\nope')).toBe('unmounted')
  })
})

// ---------- RecentDB.pruneStale integration ----------

describe('RecentDB.pruneStale', () => {
  let pruneDb: RecentDB
  let pruneDir: string
  let realDir: string

  beforeEach(async () => {
    pruneDir = mkdtempSync(join(tmpdir(), 'cmdcld-prune-'))
    realDir = mkdtempSync(join(tmpdir(), 'cmdcld-real-'))
    pruneDb = new RecentDB(join(pruneDir, 'prune.db'))
    // wait for init to complete by calling list()
    await pruneDb.list()
  })

  afterEach(() => {
    pruneDb.close()
    rmSync(pruneDir, { recursive: true, force: true })
    rmSync(realDir, { recursive: true, force: true })
  })

  it('prunes only missing entries, keeps ok and unmounted', async () => {
    const realPath = realDir               // exists on disk → 'ok'
    const missingPath = join(realDir, 'gone-subdir')  // on real root, dir absent → 'missing'
    // fake drive path: on Windows use Z:\fake (unmounted); on other platforms use a
    // path that references a non-existent mount prefix so getEffectiveRoot returns
    // something that also doesn't exist → 'unmounted'
    const fakePath = process.platform === 'win32'
      ? 'Z:\\fake-cmdcld-dir'
      : '/media/fakecmdcld/mydir'

    // Insert directly via add (startup pruneStaleInternal already ran on init,
    // but none of these paths existed then, so we insert after init resolves)
    await pruneDb.add(realPath)
    await pruneDb.add(missingPath)
    await pruneDb.add(fakePath)

    const result = await pruneDb.pruneStale()

    expect(result.pruned).toBe(1)

    const remaining = (await pruneDb.list()).map((r) => r.path)
    expect(remaining).toContain(realPath)
    expect(remaining).toContain(fakePath)
    expect(remaining).not.toContain(missingPath)
  })
})
