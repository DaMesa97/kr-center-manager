# =====================================================================
# Backup bazy Supabase (pg_dump) z rotacją: 30 dziennych + 12 miesięcznych.
#
# Wymagania:
#   * pg_dump w PATH (PostgreSQL client tools, wersja >= wersji serwera)
#   * w .env obok repo wpis:  SUPABASE_DB_URL=postgresql://...  (session pooler!)
#     — connection string z Supabase Dashboard -> Settings -> Database.
#     Sekrety NIE trafiają do tego pliku ani do repo.
#
# Uruchomienie ręczne:  powershell -File scripts\db-backup.ps1
# Harmonogram (codziennie 02:30) — patrz komenda schtasks na dole pliku.
#
# Katalog docelowy: $env:KR_BACKUP_DIR albo domyślnie %USERPROFILE%\KRCenter-Backups
# Format: custom (-Fc), skompresowany — restore przez pg_restore.
# Dzień 1. miesiąca: kopia trafia też do podkatalogu monthly\.
# =====================================================================

$ErrorActionPreference = 'Stop'

# ── Konfiguracja ────────────────────────────────────────────────────────
$repoRoot  = Split-Path -Parent $PSScriptRoot
$backupDir = if ($env:KR_BACKUP_DIR) { $env:KR_BACKUP_DIR } else { Join-Path $env:USERPROFILE 'KRCenter-Backups' }
$dailyDir   = Join-Path $backupDir 'daily'
$monthlyDir = Join-Path $backupDir 'monthly'
$logFile    = Join-Path $backupDir 'backup.log'

function Log([string]$msg) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
  Write-Host $line
  Add-Content -Path $logFile -Value $line -Encoding utf8
}

New-Item -ItemType Directory -Force $dailyDir, $monthlyDir | Out-Null

# ── Connection string z .env ────────────────────────────────────────────
$envFile = Join-Path $repoRoot '.env'
if (-not (Test-Path $envFile)) { Log "BLAD: brak pliku .env w $repoRoot"; exit 1 }
$dbUrl = (Get-Content $envFile | Where-Object { $_ -match '^\s*SUPABASE_DB_URL\s*=' } |
  Select-Object -First 1) -replace '^\s*SUPABASE_DB_URL\s*=\s*', ''
if (-not $dbUrl) { Log 'BLAD: brak SUPABASE_DB_URL w .env'; exit 1 }

# ── Dump ────────────────────────────────────────────────────────────────
$stamp = Get-Date -Format 'yyyy-MM-dd'
$file  = Join-Path $dailyDir "kr-center-$stamp.dump"
Log "Start backupu -> $file"

& pg_dump $dbUrl --format=custom --schema=public --no-owner --no-privileges --file=$file
if ($LASTEXITCODE -ne 0) { Log "BLAD: pg_dump zakonczyl sie kodem $LASTEXITCODE"; exit 1 }

$sizeMB = [math]::Round((Get-Item $file).Length / 1MB, 1)
if ($sizeMB -lt 0.1) { Log "BLAD: plik podejrzanie maly ($sizeMB MB) - backup NIEZAUFANY"; exit 1 }
Log "OK: $sizeMB MB"

# ── Kopia miesięczna (1. dzień miesiąca) ────────────────────────────────
if ((Get-Date).Day -eq 1) {
  $monthlyFile = Join-Path $monthlyDir "kr-center-$(Get-Date -Format 'yyyy-MM').dump"
  Copy-Item $file $monthlyFile -Force
  Log "Kopia miesieczna: $monthlyFile"
}

# ── Rotacja ─────────────────────────────────────────────────────────────
$oldDaily = Get-ChildItem $dailyDir -Filter '*.dump' |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) }
foreach ($f in $oldDaily) { Remove-Item $f.FullName -Force; Log "Rotacja (daily): usunieto $($f.Name)" }

$oldMonthly = Get-ChildItem $monthlyDir -Filter '*.dump' |
  Sort-Object LastWriteTime -Descending | Select-Object -Skip 12
foreach ($f in $oldMonthly) { Remove-Item $f.FullName -Force; Log "Rotacja (monthly): usunieto $($f.Name)" }

Log 'Backup zakonczony.'

# =====================================================================
# Harmonogram — odpal RAZ w PowerShell (jako swoj user), potem dziala samo:
#
#   schtasks /Create /TN "KR Center DB Backup" /SC DAILY /ST 02:30 `
#     /TR "powershell -NoProfile -ExecutionPolicy Bypass -File \"C:\Users\User\Desktop\zamowienia --template react\scripts\db-backup.ps1\""
#
# Restore (do testowego projektu / po awarii):
#   pg_restore --dbname "postgresql://...TESTOWY..." --clean --if-exists --no-owner --no-privileges plik.dump
# =====================================================================
