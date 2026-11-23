import { describe, expect, it } from 'vitest'
import { isModalOpen, markModalOpen } from '../src/renderer/src/utils/modal-state'

describe('modal state', () => {
  it('is open while any modal is, and releasing twice counts once', () => {
    expect(isModalOpen()).toBe(false)
    const a = markModalOpen()
    const b = markModalOpen()
    expect(isModalOpen()).toBe(true)
    a(); a()
    expect(isModalOpen()).toBe(true)
    b()
    expect(isModalOpen()).toBe(false)
  })
})
