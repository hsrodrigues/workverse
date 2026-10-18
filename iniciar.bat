@echo off
chcp 65001 >nul
title WorkVerse - servidor e cliente
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado. Instale em https://nodejs.org e rode de novo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias, isso so acontece na primeira vez...
  call npm install
  if errorlevel 1 (
    echo [ERRO] npm install falhou.
    pause
    exit /b 1
  )
)

rem Somente desenvolvimento: libera o atalho http://localhost:5173/?name=SeuNome
set ALLOW_DEV_LOGIN=1
rem Servidor estavel: nao reinicia ao editar arquivos (para desenvolver com reinicio automatico, use: npm run dev)
set WV_NO_WATCH=1
rem Staff (administrador) do WorkVerse: contas com estes e-mails recebem o cargo e o cracha dourado (ver docs/staff.md)
rem Para ser staff admin no ambiente local, crie um arquivo .env.local (ignorado pelo git) com a linha:
rem   BOOTSTRAP_STAFF_EMAILS=seu@email.com:admin
if exist .env.local for /f "usebackq tokens=1,* delims==" %%A in (".env.local") do set "%%A=%%B"

echo.
echo  WorkVerse iniciando...
echo   Jogo:      http://localhost:5173
echo   Servidor:  http://localhost:3001/health
echo.
echo  Para testar com 2 pessoas: abra o link em dois navegadores
echo  (ou uma janela normal e uma anonima) e crie duas contas.
echo  Atalho sem cadastro: http://localhost:5173/?name=Ana  e  ?name=Beto
echo.
echo  Feche esta janela (ou Ctrl+C) para parar tudo.
echo.

start "" /min cmd /c "timeout /t 7 /nobreak >nul & start http://localhost:5173"
call npm run dev
pause
