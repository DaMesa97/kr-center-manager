import { describe, expect, it } from 'vitest'
import { omitKeys } from '../utils'

describe('omitKeys — edycja nie wysyła pól, których formularz nie ma', () => {
  it('usuwa podane klucze, resztę zostawia, nie rusza oryginału', () => {
    const mapped = { model: 'X', frame_color: '', decorative_panel: '', handle: 'H' }
    const out = omitKeys(mapped, ['frame_color', 'decorative_panel'])
    expect(out).toEqual({ model: 'X', handle: 'H' })
    expect('frame_color' in out).toBe(false)
    expect(mapped.frame_color).toBe('')
  })
})
