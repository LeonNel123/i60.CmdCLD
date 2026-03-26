import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { RecentDB } from '../src/main/recent-db'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'

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
})
