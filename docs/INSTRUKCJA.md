# KR Center Manager — Instrukcja użytkownika

Przewodnik po programie. Ta sama treść jest dostępna w aplikacji w zakładce **Pomoc**.

---

## 🚪 Zamówienia — podstawy
Każda kategoria drzwi ma zakładkę: **STA, Disting, ST, Techniczne, Bastion, Drzwi wewnętrzne**. Lista pokazuje aktywne zlecenia (bez wydanych).

- **Nowe zlecenie** — przycisk „Nowe zamówienie", pola częściowo ze słowników.
- **Edycja** — klik w wiersz (kierownik/sprzedawca).
- **Etapy produkcji** — klik pustej komórki = Twoje **inicjały** (zrobione); klik wypełnionej = cofnięcie (z potwierdzeniem).
- **Pilne ⚡** — podbija i wyróżnia zlecenie.
- **Wydanie** — klik w kolumnie WYDANIE = data dzisiejsza; zlecenie znika z listy (→ Wysyłka/Archiwum).
- **Anuluj / Przywróć** — kolumna Akcje (kierownik).
- **Komentarze 💬** — przy numerze; oznaczanie osób przez `@`.
- **Szukajka** — `Ctrl+K` (globalna).

## 🔗 Disting Plus (STA ↔ Disting)
System **DISTING PLUS** tworzy parę: rekord Disting + STA, połączone.
- Ościeżnica = Disting, skrzydło = STA.
- Etapy mirrorują się między stronami (kolumny read-only).
- W STA kolumna **OŚĆ** = status pakowania ościeżnicy w Disting (E5).

## 🛡️ Titan / Bastion (CORE, GUARD RC2/RC3, GUARD RC3 EI 30)
Tworzy **trzy** powiązane rekordy: STA + ST + Bastion.
- **STA** — frezowanie skrzydła (E3, E5).
- **ST** — ościeżnica.
- **Bastion** — stacja końcowa: **okuwanie → montaż → pakowanie**. Chipy **OŚC / SKRZ** pokazują czy ościeżnica (z ST) i skrzydło (ze STA) dojechały.
- Każda ekipa oznacza swoje etapy; wydanie niezależne per kategoria.
- **Filtr dat** nad tabelą (data zamówienia): Dziś / Ten tydzień / Ten miesiąc / Poprzedni miesiąc / Ostatnie 30 dni / Ten kwartał / Ten rok / własny zakres od–do; „✕" czyści. Działa razem z wyszukiwarką i „Ukryj zrealizowane".
- **Aluminium**: kolumny etapów w tabeli pokazują zrobione/wszystkie sztuki w zleceniu (po wszystkich pozycjach). Klik = następna sztuka, komplet = pytanie o cofnięcie ostatniej; najechanie rozbija na pozycje z inicjałami. Kolejność wg ZKP: CIĘCIE (IS-01) → SKŁAD (IS-03) → OKUCIA (IS-04) → SZKL (IS-05) → PAK. Na zleceniu ZKP sztukę podpisuje tylko osoba z uprawnieniem w matrycy 6.27.
- Stany specjalne etapu (kierownik, prawy klik na komórce): **—** „nie dotyczy" (liczy się jako zrobione, bez osoby; rezerwacja części na ten etap wraca na magazyn, „Wznów" ją przywraca) i **⏸** „wstrzymane" z powodem (liczy się jako niezrobione; na Moim stanowisku „Wstrzymane: powód", NASTĘPNE omija). „Wznów" zdejmuje stan. Na komórkę z inicjałami stanu nie nałożysz — najpierw cofnij etap.

## ✅ Moje stanowisko
Twoje zadania — etapy gotowe do zrobienia (pilne i gotowe na górze, pierwsze ma plakietkę **NASTĘPNE**).
1. Sprawdź u góry, **kto jest zalogowany** („To nie ja — zmień osobę").
2. Klik w wiersz = szczegóły dla Twojego etapu.
3. **✓ Zrobione** → kafelek ze **swoimi inicjałami**.
4. Pomyłka: pasek **Cofnij** przez 5 min; później klik w zieloną komórkę w tabeli (tylko swoje inicjały).
5. „W magazynie brakuje części" → **Zrobione mimo braku** (magazyn dostaje informację).
6. Za małe litery: **A− / A+** w prawym górnym rogu (zostaje na tym komputerze).

## 🚛 Wysyłka (kierownik)
Zlecenia gotowe do wydania.
- Pasek postępu etapów (najedź = lista etapów).
- „Gotowe do fakturowania" — checkbox (sugerowane przy 100% / dacie wydania).
- Sortowanie po dniu trasy; ostrzeżenia o przeterminowanych.

## 📦 Magazyn
- **Stany** — ilości per magazyn (Bukowa, Marklowicka, Wewnętrzne).
- **Komponenty** — kartoteka; przy tworzeniu wybierasz magazyny; „Wyczyść błędne półki".
- **Przyjęcia (PZ)** — filtr po dostawcy i kategorii; jednostki sztukowe = całkowite.
- **Przesunięcia (MM)** — między magazynami.
- **Receptury** — co schodzi na zlecenie (auto przy realizacji).
- **Zamawianie** — sugestie (ROP), lista zakupowa, zamówienia do dostawców.
- **Inwentaryzacja** — remanent: PDF do liczenia + wprowadzanie stanów.
- **Alerty / Prognozy** — braki i zużycie.

## 🏷️ Etykiety
- **Etykieta zlecenia (dynamiczna)** — otwórz zlecenie → „🏷️ Drukuj etykietę". Auto-szablon wg kategorii + dane + QR (ID), podgląd, druk.
- **Dokumenty (DoP/ZPL)** — Etykiety → Dokumenty: gotowe pliki ZPL per kategoria, druk N kopii na Zebrę.
- **Konfiguracja (kierownik):** Etykiety → Szablony (HTML per kategoria, instrukcja + lista pól); dodawanie drukarek Zebra (IP) i plików ZPL.

## 🔔 Powiadomienia i aktualizacje
- **Dzwonek** — m.in. nowe zamówienia z konfiguratora do weryfikacji.
- **Aktualizacje** — program sprawdza nową wersję po zalogowaniu i proponuje update.

## ⚙️ Konfiguracja i uprawnienia (kierownik)
- **Konfiguracja** — słowniki, wykluczenia, czasy realizacji, ustawienia firmy.
- **Kontrahenci** — firmy, aliasy nazw, dni tras.
- **Konfiguracja → Integracje** (admin) — adres webhooka Make do „Ponów wysyłkę do Optimy". Status RO z Optimy widać przy numerze zlecenia (zielony numer RO albo czerwony „Błąd ERP"), lista błędów jest w Weryfikacji, kierownik ponawia wysyłkę przyciskiem po usunięciu przyczyny.
- **Użytkownicy** — konta, role (kierownik/pracownik/sprzedawca), działy (decydują co kto widzi). Kierownik działu widzi tu tylko pracowników produkcji ze swoich kategorii: zakłada im konta, resetuje hasła, przypisuje etapy („Etapy produkcji"), dezaktywuje. Ról nie zmienia, kont nie usuwa — to admin.
- **Klucze API** — konfigurator / integracje.
- **Audyt / Archiwum** — historia zmian i zrealizowane zlecenia.
