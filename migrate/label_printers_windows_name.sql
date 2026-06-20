-- =====================================================================
-- label_printers: nazwa drukarki w Windows (kanał HTML/etykiety QR).
-- Jeden wpis = jedna fizyczna drukarka z dwoma kanałami:
--   windows_name -> druk etykiet (HTML, webContents.print)
--   ip:port      -> druk DoP (surowy ZPL po TCP 9100)
-- =====================================================================
alter table public.label_printers add column if not exists windows_name text;
