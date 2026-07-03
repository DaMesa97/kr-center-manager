// Stub importu 'https://deno.land/std/.../http/server.ts' na potrzeby testów.
// serve() nie startuje serwera — przechwytuje handler, żeby testy mogły go
// wywołać bezpośrednio z podrobionym Request i sprawdzić Response.
type Handler = (req: Request) => Response | Promise<Response>

export const __handlers: Handler[] = []

export const serve = (handler: Handler): void => {
  __handlers.push(handler)
}
