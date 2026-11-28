import { describe, expect, it } from 'vitest'
import { zkpPinProblem, zkpPinRpcErrorText, zkpPinSetupFlow } from '../lib/zkpPin'
import { aluMarkErrorText, aluMarkWithPin, aluPinErrorFromData, type AluMarkResult } from '../lib/aluStation'

describe('D53: forma PIN-u (jak zkp_pin_problem w bazie)', () => {
  it('4–8 cyfr, bez powtórzeń i ciągów', () => {
    expect(zkpPinProblem('2580')).toBeNull()
    expect(zkpPinProblem('13579135')).toBeNull()
    expect(zkpPinProblem('12')).toMatch(/4 do 8/)
    expect(zkpPinProblem('12a4')).toMatch(/4 do 8/)
    expect(zkpPinProblem('123456789')).toMatch(/4 do 8/)
    expect(zkpPinProblem('7777')).toMatch(/powtórzoną/)
    expect(zkpPinProblem('3456')).toMatch(/kolejnymi/)
    expect(zkpPinProblem('6543')).toMatch(/kolejnymi/)
  })
  it('baza bez migracji — czytelny komunikat', () => {
    expect(zkpPinRpcErrorText({ code: 'PGRST202', message: 'x' })).toMatch(/aktualizację/)
    expect(zkpPinRpcErrorText({ code: 'P0001', message: 'inne' })).toBe('inne')
  })
})

describe('D53: ustawianie PIN-u krok po kroku', () => {
  const run = async (answers: (string | null)[], needCurrent: boolean, saveErr: string | null = null) => {
    const asked: string[] = []
    const notes: [string, boolean][] = []
    const saved: [string, string | null][] = []
    const ok = await zkpPinSetupFlow({
      needCurrent,
      whose: 'test',
      ask: async (m) => {
        asked.push(m)
        return answers.shift() ?? null
      },
      save: async (p, c) => {
        saved.push([p, c])
        return saveErr
      },
      notify: (m, o) => {
        notes.push([m, o])
      },
    })
    return { ok, asked, notes, saved }
  }
  it('z obecnym PIN-em', async () => {
    const r = await run(['2580', '1357', '1357'], true)
    expect(r.ok).toBe(true)
    expect(r.saved).toEqual([['1357', '2580']])
    expect(r.asked).toHaveLength(3)
  })
  it('bez obecnego (pierwszy PIN / administrator)', async () => {
    const r = await run(['1357', '1357'], false)
    expect(r.saved).toEqual([['1357', null]])
  })
  it('różne powtórzenie / zła forma / anulowanie / błąd bazy', async () => {
    expect((await run(['1357', '1358'], false)).saved).toEqual([])
    expect((await run(['1234'], false)).notes[0][1]).toBe(false)
    expect((await run([null], true)).asked).toHaveLength(1)
    const e = await run(['1357', '1357'], false, 'Obecny PIN jest błędny')
    expect(e.ok).toBe(false)
    expect(e.notes).toEqual([['Obecny PIN jest błędny', false]])
  })
})

describe('D53: oznaczenie sztuki z okienkiem PIN', () => {
  const ok: AluMarkResult = { data: { ciecie: { done: 1 } }, error: null }
  it('zwykłe zlecenie — jedno wywołanie bez pytania o PIN', async () => {
    const calls: (string | null)[] = []
    const res = await aluMarkWithPin(
      async (pin) => {
        calls.push(pin)
        return ok
      },
      async () => {
        throw new Error('nie powinno pytać')
      },
    )
    expect(res).toBe(ok)
    expect(calls).toEqual([null])
  })
  it('baza prosi o PIN, potem błędny, potem dobry', async () => {
    const calls: (string | null)[] = []
    const pins = ['0000', '2580']
    const asked: string[] = []
    const res = await aluMarkWithPin(
      async (pin) => {
        calls.push(pin)
        if (pin == null) return { data: null, error: { code: 'P0428', message: 'wpisz PIN' } }
        if (pin === '0000') return { data: null, error: { code: 'P0401', message: 'Błędny PIN' } }
        return ok
      },
      async (m) => {
        asked.push(m)
        return pins.shift() ?? null
      },
    )
    expect(res).toBe(ok)
    expect(calls).toEqual([null, '0000', '2580'])
    expect(asked).toEqual(['wpisz PIN', 'Błędny PIN'])
  })
  it('zamknięcie okienka = anulowano, bez kolejnego wywołania', async () => {
    let n = 0
    const res = await aluMarkWithPin(
      async () => {
        n++
        return { data: null, error: { code: 'P0428', message: 'wpisz PIN' } }
      },
      async () => null,
    )
    expect(n).toBe(1)
    expect(aluMarkErrorText(res.error!)).toMatch(/wymaga PIN-u/)
  })
  it('błędny PIN w danych bazy rozpoznany', () => {
    expect(aluPinErrorFromData({ _zkp_pin_error: 'Błędny PIN' })).toBe('Błędny PIN')
    expect(aluPinErrorFromData({ ciecie: { done: 1 } })).toBeNull()
    expect(aluPinErrorFromData(null)).toBeNull()
    expect(aluMarkErrorText({ code: 'P0424', message: 'brak PIN-u' })).toBe('Podpis ZKP — brak PIN-u')
  })
})
