import { describe, expect, it } from 'vitest'
// Pułapka #4 z ARCHITEKTURA.md: logika systemów specjalnych żyje w TRZECH kopiach
// (aplikacja + orders-intake + orders-excel-intake). Te testy pilnują, żeby kopie
// się nie rozjechały — jak ktoś doda nowy system Titana w jednej, test krzyczy.
import { isTitanSystem as appTitan, createEmptyProductionStages } from '../utils'
import {
  isTitanSystem as excelTitan,
  emptyStagesFor as excelStages,
} from '../../supabase/functions/orders-excel-intake/index'
import {
  isTitanSystem as intakeTitan,
  emptyStagesFor as intakeStages,
} from '../../supabase/functions/orders-intake/index'

const SYSTEM_SAMPLES = [
  'CORE', 'CORE 2', 'GUARD RC2', 'GUARD RC3', 'GUARD RC3 EI 30',
  'NORMAL', 'NORMAL PLUS', 'DISTING PLUS', 'BASIC LOCK PLUS', 'ST72', '',
]

describe('spójność 3 kopii logiki (apka / orders-intake / orders-excel-intake)', () => {
  it('isTitanSystem daje identyczny wynik we wszystkich kopiach', () => {
    for (const s of SYSTEM_SAMPLES) {
      const app = appTitan(s)
      expect(excelTitan(s), `excel-intake różni się dla "${s}"`).toBe(app)
      expect(intakeTitan(s), `orders-intake różni się dla "${s}"`).toBe(app)
    }
  })

  it('emptyStagesFor: obie Edge Functions tworzą identyczne klucze etapów', () => {
    for (const cat of ['STA', 'Disting', 'ST', 'Bastion', 'Techniczne']) {
      expect(Object.keys(excelStages(cat)).sort()).toEqual(Object.keys(intakeStages(cat)).sort())
    }
  })

  it('klucze etapów z Edge Functions są rozpoznawane przez aplikację (podzbiór)', () => {
    // Aplikacja może znać WIĘCEJ kluczy (mirrory, warianty Titan) — ale każdy klucz
    // tworzony przez API musi istnieć w aplikacji, inaczej import "gubi" etapy.
    for (const cat of ['STA', 'Disting', 'ST', 'Bastion']) {
      const appKeys = new Set(Object.keys(createEmptyProductionStages(cat)))
      for (const k of Object.keys(excelStages(cat))) {
        expect(appKeys.has(k), `klucz "${k}" (${cat}) z API nieznany aplikacji`).toBe(true)
      }
    }
  })
})
