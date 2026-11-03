// Przy non-2xx supabase-js daje generyczny error.message, a prawdziwy komunikat
// edge function siedzi w error.context (Response). Wyciągamy go, żeby user
// widział powód („Brak adresu webhooka…"), nie „Edge Function returned a non-2xx".
export async function fnErrorMessage(error: unknown, fallback: string): Promise<string> {
  const ctx = (error as { context?: unknown })?.context as
    | { json?: () => Promise<unknown>; text?: () => Promise<string> }
    | undefined
  try {
    if (ctx?.json) {
      const body = (await ctx.json()) as { error?: string } | null
      if (body?.error) return String(body.error)
    }
  } catch {
    /* ignore */
  }
  try {
    if (ctx?.text) {
      const t = await ctx.text()
      if (t && t.trim()) return t.trim()
    }
  } catch {
    /* ignore */
  }
  return (error as { message?: string })?.message || fallback
}
