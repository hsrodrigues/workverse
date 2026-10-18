@echo off
chcp 65001 >nul
title WorkVerse - publicar online ^(link temporario^)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado. Instale a versao LTS em https://nodejs.org e rode de novo.
  pause
  exit /b 1
)
if not exist ".env.production" (
  if exist ".env.production.example" (
    copy /y ".env.production.example" ".env.production" >nul
    echo.
    echo  Criei o arquivo .env.production a partir do modelo.
    echo  Edite-o quando quiser ^(BOOTSTRAP_STAFF_EMAILS, LiveKit, banco^). Veja docs\deploy.md.
    echo.
  )
)

echo  Publicando o WorkVerse na internet com um link temporario da Cloudflare ^(sem conta, sem abrir portas^).
echo  Na primeira vez baixa o cloudflared oficial ^(com verificacao SHA-256^).
echo.
node scripts\publicar.mjs quick
echo.
pause
