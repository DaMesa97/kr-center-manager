import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Osobny config dla testów (bez pluginów Sentry/Electron z vite.config).
// Aliasy podmieniają importy URL-owe Edge Functions (Deno) na lokalne stuby,
// dzięki czemu testujemy PRAWDZIWĄ logikę mapowania z supabase/functions/.
export default defineConfig({
  resolve: {
    alias: {
      'https://deno.land/std@0.224.0/http/server.ts': path.resolve(
        __dirname,
        'src/__tests__/stubs/deno-http-server.ts',
      ),
      'https://esm.sh/@supabase/supabase-js@2.43.0': path.resolve(
        __dirname,
        'src/__tests__/stubs/esm-supabase.ts',
      ),
      // manage-users używa innych wersji tych samych modułów
      'https://deno.land/std@0.177.0/http/server.ts': path.resolve(
        __dirname,
        'src/__tests__/stubs/deno-http-server.ts',
      ),
      'https://esm.sh/@supabase/supabase-js@2.49.1': path.resolve(
        __dirname,
        'src/__tests__/stubs/esm-supabase.ts',
      ),
    },
  },
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    environment: 'node',
  },
})
