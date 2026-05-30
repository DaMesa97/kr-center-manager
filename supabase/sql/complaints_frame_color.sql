-- Uruchom w SQL Editor (Supabase): kolumna koloru ościeżnicy dla reklamacji STA
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS frame_color text NOT NULL DEFAULT '';
