import { describe, expect, it } from 'vitest'
import { humanizeErrorText } from '../lib/friendlyError'

describe('runda 4: P0409 cofnięcie etapu na wydanym', () => {
  it('po ludzku, z polską datą', () => {
    expect(
      humanizeErrorText('Nie cofnięto etapu: Zlecenie jest już wydane (2026-11-27) — najpierw cofnij wydanie, potem etap (inaczej towar wróci na stan, a rezerwacja zostanie na zawsze).'),
    ).toBe('Nie cofnięto etapu: zlecenie jest już wydane (27.11.2026) — etap cofa kierownik dopiero po cofnięciu wydania (jeśli wydanie przyszło z Excela, najpierw trzeba usunąć X w Excelu)')
  })
})

describe('humanizeErrorText — techniczne błędy po ludzku', () => {
  it('zostawia prefiks, tłumaczy ogon (FK przy usuwaniu)', () => {
    expect(
      humanizeErrorText(
        'Błąd: update or delete on table "orders" violates foreign key constraint "x_fkey" on table "warehouse_movements"',
      ),
    ).toBe('Błąd: nie można usunąć — inne dane się do tego odwołują')
  })

  it('RLS i duplikat', () => {
    expect(humanizeErrorText('Nie zapisano: new row violates row-level security policy for table "orders"')).toBe(
      'Nie zapisano: brak uprawnień do tej operacji',
    )
    expect(humanizeErrorText('duplicate key value violates unique constraint "orders_pkey"')).toMatch(/^Taki wpis już istnieje/)
  })

  it('zachowuje polską dalszą część komunikatu po błędzie', () => {
    expect(
      humanizeErrorText('Nie zapisano daty zamówienia szyb: Failed to fetch. PDF NIE został wygenerowany — spróbuj ponownie.'),
    ).toBe('Nie zapisano daty zamówienia szyb: brak połączenia z serwerem — sprawdź internet (jeśli to był zapis, mógł się udać: odśwież listę, zanim spróbujesz ponownie). PDF NIE został wygenerowany — spróbuj ponownie.')
  })

  it('pole NOT NULL z nazwą kolumny, timeout', () => {
    expect(humanizeErrorText('Błąd: null value in column "company" of relation "orders" violates not-null constraint')).toBe(
      'Błąd: brakuje wymaganej wartości (pole company)',
    )
    expect(humanizeErrorText('Błąd: canceling statement due to statement timeout')).toMatch(/limicie czasu/)
  })

  it('własne polskie komunikaty z bazy i zwykłe teksty bez zmian', () => {
    const own = 'Nie cofnięto etapu: Brak uprawnień do cofania etapów tego zlecenia'
    expect(humanizeErrorText(own)).toBe(own)
    expect(humanizeErrorText('Uzupełnij wszystkie wymagane pola')).toBe('Uzupełnij wszystkie wymagane pola')
  })
})
