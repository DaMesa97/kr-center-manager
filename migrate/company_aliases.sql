-- =============================================================================
-- ALIASY KONTRAHENTÓW — zapamiętane ręczne dopasowania nazw konfigurator→aplikacja
-- Wklej w Supabase SQL Editor i uruchom.
--
-- Po ręcznym dopasowaniu firmy przez managera para (nazwa z BOT → nazwa z bazy)
-- jest zapisywana. Trigger automatycznie podmienia nazwę przy każdym kolejnym
-- zamówieniu z konfiguratora — bez ponownej akcji.
-- =============================================================================

-- 1) Tabela aliasów
CREATE TABLE IF NOT EXISTS company_aliases (
  id           BIGSERIAL PRIMARY KEY,
  alias_name   TEXT NOT NULL UNIQUE,   -- znormalizowana nazwa z konfiguratora (lower + trim)
  company_name TEXT NOT NULL,          -- docelowa nazwa kontrahenta z bazy
  created_by   UUID REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE company_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_aliases_all" ON company_aliases;
CREATE POLICY "company_aliases_all" ON company_aliases
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2) Trigger: przy nowym zamówieniu z BOT-a podmień nazwę firmy wg zapamiętanego aliasu
CREATE OR REPLACE FUNCTION apply_company_alias()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_name TEXT;
BEGIN
  IF NEW.source = 'bot' AND NEW.company IS NOT NULL THEN
    SELECT company_name INTO v_name
    FROM company_aliases
    WHERE alias_name = lower(trim(NEW.company))
    LIMIT 1;
    IF v_name IS NOT NULL THEN
      NEW.company := v_name;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_company_alias ON orders;
CREATE TRIGGER trg_apply_company_alias
  BEFORE INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION apply_company_alias();
