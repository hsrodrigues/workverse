# Baixa os binarios portateis oficiais do PostgreSQL (EnterpriseDB, ZIP) e extrai SOMENTE pgsql/bin
# para tools/pg/bin (pg_dump, pg_restore, psql...). Nao instala nada no sistema. tools/pg e ignorado pelo git.
# Uso: npm run pg:tools   (ou: powershell -File scripts/setup-pg-tools.ps1 [-Version 18.4-1])
param([string]$Version = '18.4-1')

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root 'tools/pg'
$bin = Join-Path $dest 'bin'
if (Test-Path (Join-Path $bin 'pg_dump.exe')) { Write-Host "[pg-tools] ja existe: $bin"; exit 0 }

$url = "https://get.enterprisedb.com/postgresql/postgresql-$Version-windows-x64-binaries.zip"
$zip = Join-Path ([IO.Path]::GetTempPath()) "workverse-pg-$Version.zip"
Write-Host "[pg-tools] baixando $url (~330 MB)"
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest -Uri $url -OutFile $zip

New-Item -ItemType Directory -Force $bin | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($zip)
try {
  foreach ($e in $archive.Entries) {
    if ($e.FullName -like 'pgsql/bin/*' -and $e.Name) {
      [IO.Compression.ZipFileExtensions]::ExtractToFile($e, (Join-Path $bin $e.Name), $true)
    }
  }
} finally { $archive.Dispose() }
Remove-Item $zip -Force
Write-Host "[pg-tools] pronto: $bin"
& (Join-Path $bin 'pg_dump.exe') --version
