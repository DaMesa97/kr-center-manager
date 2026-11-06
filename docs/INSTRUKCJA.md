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
3. Zielony przycisk **✓ Oznacz E3 jako zrobione** (na przycisku jest nazwa etapu) → kafelek ze **swoimi inicjałami**. Dużo zadań? W pasku liczników jest szukajka (numer zlecenia, firma, model).
4. Pomyłka: pasek **Cofnij** przez 5 min; później klik w zieloną komórkę w tabeli (tylko swoje inicjały).
5. „W magazynie brakuje części" → **Zrobione mimo braku** (magazyn dostaje informację).
6. Za małe litery: **A− / A+** w prawym górnym rogu (zostaje na tym komputerze).

## 🚛 Wysyłka (kierownik)
Zlecenia gotowe do wydania.
- Pasek postępu etapów (najedź = lista etapów).
- „Gotowe do fakturowania" — checkbox (sugerowane przy 100% / dacie wydania).
- Sortowanie po dniu trasy; ostrzeżenia o przeterminowanych.

## 🧭 Menu boczne (od beta.86)
- **Pulpit**, **Moje stanowisko** — na górze, bez grupy.
- **Zamówienia** — kategorie (STA, Disting, ST, Techniczne, Bastion, Drzwi wewnętrzne, Stolarka aluminiowa), a pod nimi **Weryfikacja** (duble, brak numeru klienta, błędy ERP, „Do wyjaśnienia po synchronizacji z Excelem") i **Archiwum**.
- **Synchronizacja wydań z Excela** — co godzinę automat czyta arkusze „Zamówienia *.xlsm" i zamyka zlecenia wydane w Excelu (zwalnia rezerwacje). Czego nie rozstrzygnął, jest w Weryfikacji: *Duplikaty* (jeden wiersz arkusza → kilka zleceń; zostaje zlecenie z konfiguratora, kopię z Excela anulujesz przyciskiem), *Anulowane w Excelu*, *Inne*. Kafelek na Pulpicie pokazuje godzinę ostatniej synchronizacji i ostrzega, gdy starsza niż 3 h.
- **Produkcja** — Wysyłka, Etykiety i druk, ZKP AS 75EI.
- **Magazyn** — Stany, Komponenty, Dokumenty PZ / MM, Zamawianie, Inwentaryzacja.
- **Analizy** — Statystyki, Audyt.
- **Ustawienia** — Konfiguracja, Kontrahenci, Użytkownicy, Integracje.
- Plakietki liczą tylko to, co wymaga decyzji: Weryfikacja (do sprawdzenia), Wysyłka (po terminie), Zamawianie (alerty braków). Zwinięta grupa pokazuje sumę plakietek swoich pozycji.

## 📦 Magazyn
Pięć pozycji w menu, każda z krótkim paskiem podzakładek:
- **Stany** — *Stany* (ilości per magazyn: Bukowa, Marklowicka, Wewnętrzne), *Rezerwacje* (co trzymają otwarte zlecenia), *Ruchy* (historia operacji).
- **Komponenty** — *Komponenty* (kartoteka; przy tworzeniu wybierasz magazyny; „Wyczyść błędne półki"), *Receptury* (co schodzi na zlecenie, auto przy realizacji).
- **Dokumenty PZ / MM** — *Przyjęcia (PZ)* (filtr po dostawcy i kategorii; jednostki sztukowe = całkowite), *Przesunięcia (MM)* między magazynami.
- **Zamawianie** — *Zamawianie* (sugestie ROP, lista zakupowa), *Alerty* (braki; licznik przy tej pozycji menu), *Prognozy*, *Zamówienia* do dostawców.
- **Inwentaryzacja** — remanent: PDF do liczenia + wprowadzanie stanów.
- Raport **Zużycie magazynu** jest w Analizy → Statystyki; dostawców dopisujesz w Ustawienia → Kontrahenci → Dostawcy.

## 🏷️ Etykiety
- **Etykieta zlecenia (dynamiczna)** — otwórz zlecenie → „🏷️ Drukuj etykietę". Auto-szablon wg kategorii + dane + QR (ID), podgląd, druk.
- **Dokumenty (DoP/ZPL)** — Produkcja → Etykiety i druk: gotowe pliki ZPL per kategoria, druk N kopii na Zebrę; tu też wgrywasz pliki ZPL i cechy doboru.
- **Szablony etykiet (kierownik):** Ustawienia → Konfiguracja → Szablony etykiet (HTML per kategoria, instrukcja + lista pól). Warunek `{if pole}…{/if}` drukuje fragment tylko, gdy pole ma wartość (pusty wiersz znika zamiast „-"); `{if !pole}…{/if}` odwrotnie; warunki można zagnieżdżać.

## 🔔 Powiadomienia i aktualizacje
- **Dzwonek** — m.in. nowe zamówienia z konfiguratora do weryfikacji.
- **Zmień hasło** — przycisk w prawym górnym rogu; każdy zmienia swoje (min. 8 znaków). Program uruchamia się tylko raz na komputerze — druga próba przywołuje otwarte okno.
- **Formularze** pytają przed zamknięciem, gdy masz niezapisane zmiany (klik poza oknem, X, Esc).
- **Aktualizacje** — program sprawdza nową wersję po zalogowaniu i proponuje update.

## ⚙️ Ustawienia (kierownik / admin)
- **Konfiguracja** — słowniki, wykluczenia, słownik wymiarów, naddatki szyb, dane firmy, terminy realizacji, reguły Bastion, szablony etykiet.
- **Kontrahenci** — *Klienci* (firmy, aliasy nazw, dni tras) i *Dostawcy* (firmy, od których kupuje magazyn).
- **Użytkownicy** — konta, role (kierownik/pracownik/sprzedawca), działy (decydują co kto widzi). Kierownik działu widzi tu tylko pracowników produkcji ze swoich kategorii: zakłada im konta, resetuje hasła, przypisuje etapy („Etapy produkcji"), dezaktywuje. Ról nie zmienia, kont nie usuwa — to admin.
- **Integracje** (admin) — *Klucze API* (konfigurator, arkusz Excel) oraz *Make / Optima*: adres webhooka do „Ponów wysyłkę do Optimy". Status RO z Optimy widać przy numerze zlecenia (zielony numer RO albo czerwona plakietka „błąd"; klik w plakietkę = szczegóły, data, treść błędu), lista błędów jest w Zamówienia → Weryfikacja, kierownik ponawia wysyłkę przyciskiem po usunięciu przyczyny.
- **Audyt** jest w Analizach, **Archiwum** w Zamówieniach.
