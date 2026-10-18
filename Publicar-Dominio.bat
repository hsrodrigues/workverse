@echo off
chcp 65001 >nul
title WorkVerse - publicar com dominio proprio
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

echo  Publicando com tunel nomeado da Cloudflare. Requer, no .env.production:
echo    TUNNEL_NAME=nome-do-tunel     PUBLIC_URL=https://escritorio.seudominio.com
echo  ^(crie o tunel uma vez: veja docs\deploy.md, caminho B^)
echo.
node scripts\publicar.mjs named
echo.
pause
