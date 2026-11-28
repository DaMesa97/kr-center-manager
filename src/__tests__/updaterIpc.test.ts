// Noc 28.11: wspólny formatSpeed paska / blokady aktualizacji (zachowanie jak w dawnych kopiach).
import { describe, expect, it } from 'vitest'
import { formatSpeed } from '../lib/updaterIpc'

describe('formatSpeed', () => {
  it('B/s, KB/s (bez miejsc), MB/s (1 miejsce)', () => {
    expect(formatSpeed(12)).toBe('12 B/s')
    expect(formatSpeed(300 * 1024)).toBe('300 KB/s')
    expect(formatSpeed(1.5 * 1024 * 1024)).toBe('1.5 MB/s')
  })
})
