import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sha256, toHex } from './sha256'

// Deterministic filler, so a failure names the same length on every run.
function bytesOf(length: number): Uint8Array {
  const out = new Uint8Array(length)
  let state = 0x9e3779b9
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    out[i] = state >>> 24
  }
  return out
}

const nodeSha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')

describe('sha256', () => {
  it('bate com os vetores conhecidos', () => {
    expect(toHex(sha256(new Uint8Array(0)))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(toHex(sha256(new TextEncoder().encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('bate com o crypto do Node nos tamanhos em que o preenchimento muda de forma', () => {
    for (const length of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 65_537, 1_000_003]) {
      const data = bytesOf(length)
      expect(toHex(sha256(data)), `${length} bytes`).toBe(nodeSha256(data))
    }
  })
})
