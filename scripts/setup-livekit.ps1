# Baixa o binario livekit-server (Apache-2.0) para tools/livekit/ (ignorado pelo git).
# Uso: npm run livekit:setup            (versao fixa v1.13.10; -Version latest para a mais nova)
#      .\scripts\setup-livekit.ps1 -Version v1.13.10
param([string]$Version = 'v1.13.10')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root 'tools/livekit'
$exe = Join-Path $dest 'livekit-server.exe'
if (Test-Path $exe) { Write-Host "Ja instalado: $exe"; & $exe --version; exit 0 }
New-Item -ItemType Directory -Force $dest | Out-Null
$api = if ($Version -eq 'latest') { 'https://api.github.com/repos/livekit/livekit/releases/latest' } else { "https://api.github.com/repos/livekit/livekit/releases/tags/$Version" }
$rel = Invoke-RestMethod $api -Headers @{ 'User-Agent' = 'workverse-setup' }
$asset = $rel.assets | Where-Object { $_.name -like '*windows_amd64.zip' } | Select-Object -First 1
if (-not $asset) { throw "Asset windows_amd64 nao encontrado na release $($rel.tag_name)." }
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("livekit-" + [guid]::NewGuid())
New-Item -ItemType Directory $tmp | Out-Null
try {
  $zip = Join-Path $tmp $asset.name
  Write-Host "Baixando $($asset.name) ($($rel.tag_name))..."
  Invoke-WebRequest $asset.browser_download_url -OutFile $zip -Headers @{ 'User-Agent' = 'workverse-setup' }
  Expand-Archive $zip -DestinationPath (Join-Path $tmp 'out')
  $bin = Get-ChildItem (Join-Path $tmp 'out') -Recurse -Filter 'livekit-server.exe' | Select-Object -First 1
  if (-not $bin) { throw 'livekit-server.exe nao encontrado no zip.' }
  Copy-Item $bin.FullName $exe
} finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
Write-Host "Pronto: $exe"
& $exe --version
