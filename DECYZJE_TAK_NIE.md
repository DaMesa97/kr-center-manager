# Decyzje — lista TAK / NIE (noc 27–28.11.2026)

Odpowiedz przy każdym punkcie TAK albo NIE (albo krótko, gdy pytam o fakt). Szczegóły każdego punktu: `DECISIONS.md` (numer D…).
Wszystko, czego tu nie ma, to punkty, w których wystarczy zgoda na moją rekomendację — lista na końcu.

## 1. Pilne — czynności (zgoda, żebym przygotował / żebyś zrobił)
1. **D1** Wgrać od razu plik bezpieczeństwa `20261127234000` (dziś bez logowania da się anulować rezerwacje). — TAK / NIE
2. **D2** Wyłączyć w panelu Supabase zakładanie nowych kont (Authentication → „Allow new users to sign up”). Robisz Ty w panelu. — TAK / NIE
3. **D3** Wgrać cały pakiet 50 plików bazy jednym skryptem, gdy nikt nie pracuje, potem skrypt kontroli. — TAK / NIE
4. **D4** Po D3 opublikować wersję 1.1.8 („tnij”). — TAK / NIE
5. **D5** Korekta 7 ram zdjętych mimo etapu „nie dotyczy” (5 zleceń ST). — TAK / NIE
6. **D6** Oznaczyć 16 232 stare wiersze rezerwacji jako zastąpione (porządek, nic nie zmienia stanów). — TAK / NIE
7. **D39** Wdrożyć poprawkę CRM — wycena Bastionów P-110 i podobnych. — TAK / NIE
8. **D70** Wgrać poprawkę numeracji (licznik umów 2026 = 71, przy setnej numery by się powtarzały) i dodać unikalność numeru umowy. — TAK / NIE

## 2. Pytania o fakty (tylko Ty wiesz)
9. **D42** Excel zdejmuje drugi raz towar wydany przed spisem 6.11. Czy liczyć próg 7.11 od **daty wydania wpisanej w Excelu** (wtedy cofnę 5 zleceń, 280 szt.)? — TAK / NIE
10. **D12** Czy ceny z konfiguratora mają być **tajne dla hali i magazynu**? (dziś widać je w danych przez F12) — TAK / NIE
11. **D63** Czy telefony na hali są **wspólne** (kilka osób na jednym)? — TAK / NIE
12. **D57** Czy zdarzają się zlecenia **mieszane** AS 75EI (przeciwpożarowe) + zwykłe AS75 w jednym? — TAK / NIE
13. **D31** Czy **magazynier** ma planować trasy dostaw? — TAK / NIE
14. **D32** Co znaczy „E” w szerokości „90E”? Jeśli to tylko inny zapis „90” — ujednolicę. — TAK (to samo) / NIE (inny wymiar)
15. **D25** Czy hala może wpisywać w Excelu **datę** zamiast samego „X” przy ST / Bastion (dla statystyk czasu realizacji)? — TAK / NIE
16. **D34** Techniczne (797 otwartych, prawie nigdy niewydawane): czy wydanie ma przychodzić **z Excela**? (NIE = zamkniemy stare ręcznie) — TAK / NIE
17. **D44** 5 nóg Disting z anulowanym STA trzyma 265 szt. rezerwacji — czy **anulować te nogi**? (NIE = Disting jest robiony bez STA) — TAK / NIE
18. **D68** Tabele `migracja_*` (pozostałość po migracji STA) — czy można je **usunąć** (po kopii)? — TAK / NIE
19. **D36** „Ponów do Optimy” nie ma adresu webhooka — czy go **uzupełnisz** (TAK), czy schować przycisk (NIE)?

## 3. Wybory biznesowe (moja rekomendacja = TAK)
20. **D7** Prognozy magazynowe: przy < 3 pełnych miesiącach historii pokazywać średnią „orientacyjną” z oznaczeniem, alerty nie gasną. — TAK / NIE
21. **D11** Kierownik działu widzi w Weryfikacji i powiadomieniach **tylko swoje kategorie**. — TAK / NIE
22. **D62** Na telefonie każdy widzi tylko swoje kategorie; drzwi wewnętrzne odhacza tylko kierownik, magazynier i kierownik działu drzwi wewn. — TAK / NIE
23. **D22 + D64** Cofnięcie etapu w programie jest zapamiętywane i **Excel go nie przywraca** (zlecenia i reklamacje). — TAK / NIE
24. **D17** Klient ze sklepu z potwierdzonym zamówieniem → automatycznie „wygrany” w CRM. (NIE = dopiero po wpłacie) — TAK / NIE
25. **D19** Pozwolić na „podpisana → anulowana” przy odstąpieniu od umowy (z potwierdzeniem). — TAK / NIE
26. **D43** Wydanego zlecenia nie da się anulować z menu; anulowanie pary / Titana pomija wydane nogi. — TAK / NIE
27. **D26** Archiwizacja po dacie **wydania** (nie założenia); pary i Titany tylko w całości. — TAK / NIE
28. **D14** Przed kolejnym spisem: blokada PZ / MM na magazynie z otwartym spisem albo godzina liczenia na kartce. — TAK / NIE
29. **D30** „Oznacz jako wydane” w Wysyłkach robi rozchód dla zleceń od 6.11 (jak reszta programu). — TAK / NIE
30. **D41** Gdy zdjęcie z magazynu się nie uda, etap się zapisuje, a zlecenie trafia na listę w Weryfikacji (hala nie stoi). — TAK / NIE
31. **D59** Szablony etykiet i dokumentów edytuje tylko admin / superadmin. — TAK / NIE
32. **D66** Limit czasu zapisu na telefonie (np. 30 s) z komunikatem „mógł się zapisać — odśwież”. — TAK / NIE

### ZKP — przed pierwszym zleceniem ZKP (może poczekać do startu)
33. **D52** ZKP na zleceniu 75EI wyłącza tylko Pełnomocnik / Zastępca, z powodem. — TAK / NIE
34. **D53** Podpis etapu ZKP potwierdzany **PIN-em** osoby podpisującej. — TAK / NIE
35. **D54** Etapy ZKP dopiero po „Uruchom do produkcji”, pakowanie dopiero po zwolnieniu karty. — TAK / NIE
36. **D58** Niezgodna partia materiału → obowiązkowa kwarantanna; dostawca po terminie oceny = niekwalifikowany (decyzja Pełnomocnika). — TAK / NIE

## 4. Zgoda hurtem na moje rekomendacje (bez pytań)
D8, D9, D13, D15, D16, D18, D20, D21, D23, D24, D27, D28, D29, D33, D35, D37, D38, D40, D45, D46, D47, D48, D49, D50, D51, D55, D56, D60, D61, D65, D67, D69 — w każdym jest rekomendacja w `DECISIONS.md`. Wystarczy „zgoda na resztę” albo numery, których NIE chcesz.
