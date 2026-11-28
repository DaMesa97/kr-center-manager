// D51 (28.11): jedna mediana w statystykach — pusta lista = null (brak danych to nie „0 dni”).
export function mediana(nums: readonly number[]): number | null {
  if (nums.length === 0) return null
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}
