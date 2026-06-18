-- =============================================================================
-- POWIADOMIENIA IN-APP — tabela, RLS, realtime, triggery
-- Wklej w Supabase SQL Editor i uruchom.
-- =============================================================================

-- 1) Tabela powiadomień
CREATE TABLE IF NOT EXISTS notifications (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,              -- 'review' | 'stock' | 'complaint' | 'mention' | 'overdue'
  title         TEXT NOT NULL,
  body          TEXT,
  link_tab      TEXT,                       -- dokąd nawigować po kliknięciu
  link_order_id BIGINT,
  is_read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2) RLS — każdy widzi tylko swoje powiadomienia
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own_notifications_select" ON notifications;
CREATE POLICY "own_notifications_select" ON notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "own_notifications_update" ON notifications;
CREATE POLICY "own_notifications_update" ON notifications
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- INSERT robią triggery (SECURITY DEFINER) — dodajemy też politykę dla bezpieczeństwa
DROP POLICY IF EXISTS "insert_notifications" ON notifications;
CREATE POLICY "insert_notifications" ON notifications
  FOR INSERT TO authenticated WITH CHECK (true);

-- 3) Indeks pod licznik nieprzeczytanych
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, is_read, created_at DESC);

-- 4) Realtime (idempotentnie — nie rzuca błędu jeśli tabela już dodana)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 5) Trigger: zamówienie z konfiguratora WYMAGAJĄCE WERYFIKACJI → powiadom managerów
-- Powiadamiamy TYLKO gdy extra_fields.needs_review = true LUB są ostrzeżenia (warnings).
-- Zwykłe BOT-zamówienia (bez flagi weryfikacji) nie generują powiadomień.
CREATE OR REPLACE FUNCTION notify_managers_new_review()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_needs_review BOOLEAN;
BEGIN
  v_needs_review :=
    (NEW.extra_fields->>'needs_review')::boolean IS TRUE
    OR (
      jsonb_typeof(NEW.extra_fields->'warnings') = 'array'
      AND jsonb_array_length(NEW.extra_fields->'warnings') > 0
    );

  IF NEW.source = 'bot' AND v_needs_review THEN
    INSERT INTO notifications (user_id, type, title, body, link_tab, link_order_id)
    SELECT
      p.id,
      'review',
      'Zamówienie do weryfikacji',
      'Zlecenie ' || COALESCE(NEW.order_number, '?') || ' (' || COALESCE(NEW.category, '?') || ') — ' ||
        COALESCE(NEW.company, '') || ' wymaga weryfikacji',
      'Weryfikacja',
      NEW.id
    FROM profiles p
    WHERE p.role = 'manager';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_review ON orders;
CREATE TRIGGER trg_notify_review
  AFTER INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION notify_managers_new_review();

-- 6) Trigger: nowa reklamacja → powiadom managerów
CREATE OR REPLACE FUNCTION notify_managers_new_complaint()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO notifications (user_id, type, title, body, link_tab, link_order_id)
  SELECT
    p.id,
    'complaint',
    'Nowa reklamacja',
    'Reklamacja dla zlecenia ' || COALESCE(NEW.order_number, '?'),
    NEW.category,
    NULL
  FROM profiles p
  WHERE p.role = 'manager';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_complaint ON complaints;
CREATE TRIGGER trg_notify_complaint
  AFTER INSERT ON complaints
  FOR EACH ROW EXECUTE FUNCTION notify_managers_new_complaint();

-- 7) Sprzątanie starych przeczytanych (opcjonalnie odpalaj okresowo)
-- DELETE FROM notifications WHERE is_read = TRUE AND created_at < NOW() - INTERVAL '30 days';
