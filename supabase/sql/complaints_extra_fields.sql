-- Flagi anulowania partnera (DISTING PLUS) na reklamacjach: disting_cancelled w JSONB
ALTER TABLE complaints
  ADD COLUMN IF NOT EXISTS extra_fields jsonb;

COMMENT ON COLUMN complaints.extra_fields IS 'JSON m.in. disting_cancelled przy usunięciu powiązanej reklamacji Disting';
