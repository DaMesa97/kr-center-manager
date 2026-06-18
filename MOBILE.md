# KR Center — wersja mobilna (Pakowanie + foto)

Lekka aplikacja webowa (PWA) do pakowania i foto-dokumentacji zamówień z telefonu.
Współdzieli bazę Supabase z aplikacją desktopową — te same logowania, te same dane.

## Co umie
- Logowanie (ten sam login/hasło co w apce desktop)
- Wyszukiwanie zamówienia (nr zlecenia / firma / nr klienta)
- Robienie zdjęć gotowych drzwi aparatem telefonu → zapis do zamówienia
- Podgląd i usuwanie zdjęć

Zdjęcia trafiają do tego samego miejsca co foto-dokumentacja w desktopie
(Wysyłka → Szczegóły → Foto-dokumentacja). Wymaga wklejonego `migrate/order_photos.sql`.

---

## Szybki test w sieci lokalnej (bez hostingu)
1. Na komputerze: `npm run dev:mobile`
2. Sprawdź lokalny IP komputera (np. `ipconfig` → 192.168.x.x)
3. Na telefonie (ta sama sieć Wi-Fi) wejdź: `http://192.168.x.x:5173/mobile.html`

## Produkcja — hosting (wybierz jeden)
Najpierw zbuduj: `npm run build:mobile` → powstaje katalog `dist-mobile/`.

### Opcja A — Netlify Drop (najszybsze, bez konta-konfiguracji)
1. Wejdź na https://app.netlify.com/drop
2. Przeciągnij katalog `dist-mobile` na stronę
3. Dostajesz URL — wejdź na `<url>/mobile.html` na telefonie

### Opcja B — Vercel / Cloudflare Pages
1. Połącz repo lub wgraj `dist-mobile`
2. Build command: `npm run build:mobile`, output dir: `dist-mobile`
3. (opcjonalnie) rewrite `/* → /mobile.html` żeby działał goły adres bez `/mobile.html`

## Instalacja na telefonie jako apka (PWA)
1. Otwórz adres w przeglądarce (Chrome/Safari)
2. Menu → „Dodaj do ekranu głównego"
3. Ikona pojawi się jak zwykła apka, otwiera się pełnoekranowo

---

## Bezpieczeństwo
- Logowanie przez Supabase Auth (te same konta)
- Dane chronione przez RLS (Row Level Security) — użytkownik widzi tylko to, do czego ma dostęp
- Klucz `anon` w kodzie jest publiczny z założenia (taki sam jak w desktopie) — bezpieczeństwo zapewnia RLS, nie ukrycie klucza

## Aktualizacja
Po zmianach: `npm run build:mobile` i ponowny deploy `dist-mobile`.
PWA odświeża się sama przy kolejnym otwarciu (web — brak instalatora).
