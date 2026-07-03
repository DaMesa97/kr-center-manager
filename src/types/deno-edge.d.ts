// Deklaracje typów dla Edge Functions (Deno) importowanych w testach.
// Dzięki nim tsc aplikacji rozumie importy URL-owe i globalne Deno,
// a testy mogą sprawdzać PRAWDZIWĄ logikę z supabase/functions/.

declare module 'https://deno.land/std@0.224.0/http/server.ts' {
  export function serve(handler: (req: Request) => Response | Promise<Response>): void
}

declare module 'https://deno.land/std@0.177.0/http/server.ts' {
  export function serve(handler: (req: Request) => Response | Promise<Response>): void
}

declare module 'https://esm.sh/@supabase/supabase-js@2.43.0' {
  // Minimalny kształt używany przez funkcje (klient jest typowany luźno)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function createClient(url: string, key: string): any
}

declare module 'https://esm.sh/@supabase/supabase-js@2.49.1' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function createClient(url: string, key: string, options?: unknown): any
}

declare const Deno: {
  env: { get(name: string): string | undefined }
}
