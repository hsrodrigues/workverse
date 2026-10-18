@echo off
chcp 65001 >nul
title WorkVerse - producao
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

echo  WorkVerse em modo PRODUCAO ^(site + API na mesma porta^)
echo  Config: .env.production   ^|   Para por na internet: Publicar-Online.bat
echo  Feche esta janela ^(ou Ctrl+C^) para parar.
echo.
call npm run start:prod
echo.
echo  O servidor parou. Se apareceu "Configuracao insegura", corrija o .env.production e rode de novo.
pause
