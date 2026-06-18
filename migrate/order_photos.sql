-- =============================================================================
-- FOTO-DOKUMENTACJA ZAMÓWIEŃ — bucket Storage + tabela + RLS
-- Wklej w Supabase SQL Editor i uruchom.
-- =============================================================================

-- 1) Bucket na zdjęcia (publiczny odczyt — zdjęcia gotowych drzwi)
INSERT INTO storage.buckets (id, name, public)
VALUES ('order-photos', 'order-photos', true)
ON CONFLICT (id) DO NOTHING;

-- 2) Polityki Storage — zalogowani mogą wgrywać/usuwać, wszyscy odczytywać
DROP POLICY IF EXISTS "order_photos_read" ON storage.objects;
CREATE POLICY "order_photos_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'order-photos');

DROP POLICY IF EXISTS "order_photos_insert" ON storage.objects;
CREATE POLICY "order_photos_insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'order-photos');

DROP POLICY IF EXISTS "order_photos_delete" ON storage.objects;
CREATE POLICY "order_photos_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'order-photos');

-- 3) Tabela metadanych zdjęć
CREATE TABLE IF NOT EXISTS order_photos (
  id           BIGSERIAL PRIMARY KEY,
  order_id     BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,            -- ścieżka w buckecie
  public_url   TEXT NOT NULL,
  uploaded_by  UUID REFERENCES auth.users(id),
  uploaded_by_initials TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE order_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "order_photos_all" ON order_photos;
CREATE POLICY "order_photos_all" ON order_photos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_order_photos_order ON order_photos(order_id);
