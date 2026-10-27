# ZKP AS 75EI — matryca kompetencji (zał. 6.27), skład zakładu (zał. 6.1), okna poza zakresem

> Brief v2 (27.10.2026) pkt 5 i 10.2. Baza: `migrate/zkp_06_matryca_kompetencji.sql` (wymaga zkp_05).

## Co się zmieniło

1. **Okna techniczne poza zakresem ZKP** — w karcie wyrobu typ tylko „Drzwi wewnętrzne / zewnętrzne"
   (CHECK w bazie, formularz, testy). Istniejące karty z typem „okno" → typ pusty (kart jeszcze nie było).
2. **Stanowisko wg zał. 6.1** — `profiles.zkp_position`: Właściciel, Pełnomocnik ZKP / Kierownik Produkcji
   (jedna osoba), Zastępca, Operator CNC i piły, Monter, Pomocnik montera. Nadaje admin w Użytkownikach
   (trigger `protect_profile_privileges`). Stanowisko jest opisowe — co kto może podpisać, mówi matryca.
3. **Matryca kompetencji 6.27** — `zkp_competencies`: osoba × operacja (IS-01 cięcie, IS-02 wkłady,
   IS-03 uszczelki/łączenie, IS-04 okucia, IS-05 szklenie, IS-06 regulacja, kontrola odbiorcza, montaż).
   Nadanie: `zkp_grant_competency` (Pełnomocnik / Zastępca; data, podstawa, podpis z serwera).
   Wycofanie: `zkp_withdraw_competency` z powodem — wpis zostaje (zał. 6.34), audyt, retencja 10 lat.
4. **Każdy podpis sprawdzany w matrycy** — `zkp_record_card_stage` zamienia inicjały operatora na osobę
   (`zkp_profile_by_initials`, bez rozróżniania wielkości liter; niejednoznaczne inicjały → błąd) i odmawia,
   gdy osoba nie ma aktywnego uprawnienia do operacji etapu (`zkp_stage_operation`). Wpis etapu pamięta
   `operator_id`. Dotyczy to także Pełnomocnika — podpis to osoba, nie rola.
   `zkp_assert_competency(profile, 'kontrola_odbiorcza' | 'montaz')` czeka na etap D i protokół 6.28.

## Gdzie w programie

- ZKP AS 75EI → **Matryca kompetencji (6.27)**: tabela osoba × operacja; ✓ = aktywne uprawnienie (najechanie:
  od kiedy, podstawa, kto nadał; klik = wycofanie z powodem), + = nadaj (data, podstawa). Domyślnie osoby ze
  stanowiskiem ZKP albo z uprawnieniem; „Pokaż wszystkich" — reszta. Historia wycofań. Wydruk PDF 6.27
  (układ własny: osoba, stanowisko, kolumny operacji z datą nadania — dopasować po otrzymaniu wzoru załącznika).
- Karta wyrobu, cz. C: pole „Operator" to lista osób z uprawnieniem do operacji etapu (zamiast wolnego tekstu);
  gdy nikt nie ma uprawnienia — komunikat, zapis zablokowany (baza i tak odmówi).
- Użytkownicy: pole „Stanowisko ZKP (zał. 6.1)".

## Test lokalny (Postgres z atrapami, zkp_00…zkp_06)

okno → błąd CHECK; etap bez uprawnienia → błąd z nazwiskiem i operacją; nieznane inicjały → błąd; operator nie nadaje;
PJ nadaje, powtórka → „już ma"; zła operacja → CHECK; „ jk " → zapis z inicjałami z profilu i `operator_id`;
IS-03 bez uprawnienia → błąd; wycofanie bez powodu → błąd; po wycofaniu etap → błąd; ponowne nadanie = nowy wpis;
PJ bez uprawnienia IS-01 → też błąd; stanowisko spoza listy → CHECK; audyt INSERT/UPDATE; retencja zostawia.

## Po wdrożeniu

Przed pierwszą kartą: admin nadaje stanowiska, Pełnomocnik nadaje uprawnienia (choćby sobie) — bez tego żaden
etap karty nie da się podpisać. Konta hali są wspólne (decyzja właściciela), więc podpis = inicjały osoby z matrycy.
