@echo off
chcp 65001 >nul
title WorkVerse - bots de teste
cd /d "%~dp0"
rem Precisa do servidor rodando com iniciar.bat (que ja libera ALLOW_DEV_LOGIN).
set COUNT=%1
if "%COUNT%"=="" set COUNT=8
echo Entrando %COUNT% bots no escritorio. Ctrl+C para parar.
call npm run bots -w @workverse/server -- --count %COUNT% --room office --prefix Bot --talk 6000
pause
