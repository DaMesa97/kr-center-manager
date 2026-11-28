// Komórka CSV dla polskiego Excela (średnik). Runda 10 (28.11): tekst zaczynający się od = + - @
// albo tabulatora / CR Excel czyta jako formułę — dopisujemy apostrof (OWASP CSV injection).
// Tylko dla pól tekstowych; liczby (także ujemne) idą osobną funkcją qty().
export const csvCell = (v: unknown): string => {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
