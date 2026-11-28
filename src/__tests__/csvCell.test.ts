import { describe, expect, it } from 'vitest'
import { csvCell } from '../lib/csvCell'

describe('csvCell', () => {
  it('zwykły tekst bez zmian, null pusty', () => {
    expect(csvCell('PROFIL 60')).toBe('PROFIL 60')
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })
  it('cytuje średnik, cudzysłów i nową linię', () => {
    expect(csvCell('a;b')).toBe('"a;b"')
    expect(csvCell('20" drzwi')).toBe('"20"" drzwi"')
    expect(csvCell('a\nb')).toBe('"a\nb"')
  })
  it('formuły Excela dostają apostrof', () => {
    expect(csvCell('=1+1')).toBe("'=1+1")
    expect(csvCell('+48 123')).toBe("'+48 123")
    expect(csvCell('-PROFIL')).toBe("'-PROFIL")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell('=HYPERLINK("x";"y")')).toBe(`"'=HYPERLINK(""x"";""y"")"`)
  })
})
